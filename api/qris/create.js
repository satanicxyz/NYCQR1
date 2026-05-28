const crypto = require("crypto")
const QRCode = require("qrcode")
const axios = require("axios")

function convertCRC16(str) {
  let crc = 0xffff
  const strlen = str.length

  for (let c = 0; c < strlen; c++) {
    crc ^= str.charCodeAt(c) << 8

    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021
      } else {
        crc = crc << 1
      }
    }
  }

  let hex = crc & 0xffff
  hex = ("000" + hex.toString(16).toUpperCase()).slice(-4)

  return hex
}

function generateTransactionId() {
  return `QRIS-${crypto.randomBytes(4).toString("hex").toUpperCase()}`
}

function generateExpirationTime() {
  const expirationTime = new Date()
  expirationTime.setMinutes(expirationTime.getMinutes() + 5) // 5 minutes
  return expirationTime
}

async function checkExistingPayments(ordId, ordApikey) {
  try {
    const url = `https://gateway.okeconnect.com/api/mutasi/qris/${ordId}/${ordApikey}`

    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent": "QRIS-Gateway/1.0",
        Accept: "application/json",
      },
    })

    if (response.data && response.data.status === "success") {
      const payments = response.data.data || []

      const existingAmounts = payments
        .filter((payment) => payment.type === "CR" && payment.qris === "static")
        .map((payment) => Number.parseInt(payment.amount))
        .filter((amount) => !isNaN(amount))

      return existingAmounts
    } else {
      return []
    }
  } catch (error) {
    console.error("✗ Error checking existing payments:", error.message)
    return []
  }
}

async function findUniqueAmount(baseAmount, ordId, ordApikey) {
  let amount = baseAmount
  let attempts = 0
  const maxAttempts = 100

  const existingAmounts = await checkExistingPayments(ordId, ordApikey)

  const pendingAmounts = []
  if (global.transactions && global.transactions.size > 0) {
    for (const [transactionId, transaction] of global.transactions) {
      if (transaction.status === "pending") {
        pendingAmounts.push(transaction.amount)
      }
    }
  }

  const allExistingAmounts = [...existingAmounts, ...pendingAmounts]

  while (attempts < maxAttempts) {
    const amountExists = allExistingAmounts.includes(amount)

    if (!amountExists) {
      return {
        finalAmount: amount,
        wasAdjusted: amount !== baseAmount,
        adjustedBy: amount - baseAmount,
      }
    }

    amount += 1
    attempts += 1
  }

  const randomSuffix = Math.floor(Math.random() * 1000) + 100
  const finalAmount = baseAmount + randomSuffix

  return {
    finalAmount: finalAmount,
    wasAdjusted: true,
    adjustedBy: finalAmount - baseAmount,
  }
}

async function createQRIS(amount, codeqr) {
  try {
    if (!codeqr || codeqr.length < 10) {
      throw new Error("Invalid CODEQR - too short or empty")
    }

    let qrisData = codeqr.trim()

    // Remove existing CRC (last 4 characters)
    qrisData = qrisData.slice(0, -4)

    // Replace static with dynamic
    const step1 = qrisData.replace("010211", "010212")
    const step2 = step1.split("5802ID")

    if (step2.length !== 2) {
      throw new Error("Invalid QRIS format - cannot split by 5802ID")
    }

    amount = amount.toString()
    let uang = "54" + ("0" + amount.length).slice(-2) + amount
    uang += "5802ID"

    const finalQrisString = step2[0] + uang + step2[1] + convertCRC16(step2[0] + uang + step2[1])

    // Generate QR code with multiple format options
    const qrOptions = {
      width: 512,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
      errorCorrectionLevel: "M",
      type: "image/png",
    }

    const qrDataURL = await QRCode.toDataURL(finalQrisString, qrOptions)

    if (!qrDataURL.startsWith("data:image/png;base64,")) {
      throw new Error("Invalid QR code data URL format")
    }

    const transactionData = {
      idtransaksi: generateTransactionId(),
      jumlah: Number.parseInt(amount),
      expired: generateExpirationTime(),
      qrisString: finalQrisString,
      imageqris: {
        url: qrDataURL,
        format: "base64",
        size: "512x512",
        type: "image/png",
      },
    }

    return transactionData
  } catch (error) {
    console.error("✗ Error in createQRIS:", error.message)
    throw error
  }
}

module.exports = (app) => {
  app.post("/api/qris/create", async (req, res) => {
    try {
      const { amount } = req.body

      // Input validation
      if (!amount || typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({
          status: false,
          message: "Jumlah harus diisi dan lebih dari 0",
        })
      }

      if (amount > 100000000) {
        return res.status(400).json({
          status: false,
          message: "Jumlah tidak boleh melebihi Rp 100.000.000",
        })
      }

      if (!Number.isInteger(amount)) {
        return res.status(400).json({
          status: false,
          message: "Jumlah harus berupa bilangan bulat",
        })
      }

      const codeqr = process.env.CODEQR
      const ordId = process.env.ORD_ID
      const ordApikey = process.env.ORD_APIKEY

      if (!codeqr) {
        return res.status(500).json({
          status: false,
          message: "Konfigurasi QRIS tidak ditemukan",
        })
      }

      if (!ordId || !ordApikey) {
        return res.status(500).json({
          status: false,
          message: "Konfigurasi payment gateway tidak lengkap",
        })
      }

      const amountResult = await findUniqueAmount(amount, ordId, ordApikey)
      const finalAmount = amountResult.finalAmount

      // Create QRIS with final amount
      const qrisResult = await createQRIS(finalAmount, codeqr)

      // Store transaction in memory
      global.transactions.set(qrisResult.idtransaksi, {
        ...qrisResult,
        status: "pending",
        createdAt: new Date(),
        amount: finalAmount,
        originalAmount: amount, // Keep track of original amount
        wasAmountAdjusted: amountResult.wasAdjusted,
        amountAdjustment: amountResult.adjustedBy,
      })

      // Send response with adjustment info
      const response = {
        status: true,
        message: amountResult.wasAdjusted
          ? `QRIS berhasil dibuat dengan penyesuaian jumlah (Rp ${amount.toLocaleString("id-ID")} → Rp ${finalAmount.toLocaleString("id-ID")})`
          : "QRIS berhasil dibuat",
        data: {
          ...qrisResult,
          originalAmount: amount,
          wasAmountAdjusted: amountResult.wasAdjusted,
          amountAdjustment: amountResult.adjustedBy,
        },
        timestamp: new Date().toISOString(),
      }

      res.json(response)
    } catch (error) {
      console.error("✗ Error in /api/qris/create:", error.message)

      res.status(500).json({
        status: false,
        message: "Gagal membuat QRIS. Silakan coba lagi.",
      })
    }
  })
}
