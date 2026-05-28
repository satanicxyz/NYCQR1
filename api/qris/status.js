const axios = require("axios")

module.exports = (app) => {
  app.get("/api/qris/status/:transactionId", async (req, res) => {
    try {
      const { transactionId } = req.params

      // Validate transactionId format
      if (!transactionId || !/^QRIS-[A-F0-9]{8}$/.test(transactionId)) {
        return res.status(400).json({
          status: false,
          message: "Invalid transaction ID format",
        })
      }

      if (!global.transactions || !global.transactions.has(transactionId)) {
        return res.status(404).json({
          status: false,
          message: "Transaction not found",
        })
      }

      const transaction = global.transactions.get(transactionId)
      const now = new Date()
      const expiredTime = new Date(transaction.expired)

      if (now >= expiredTime && transaction.status === "pending") {
        transaction.status = "expired"
        global.transactions.set(transactionId, transaction)

        return res.json({
          status: true,
          message: "Transaction expired",
          data: {
            ...transaction,
            status: "expired",
          },
        })
      }

      // If still pending and not expired, check payment status from OrderKuota
      if (transaction.status === "pending") {
        try {
          const ordId = process.env.ORD_ID
          const ordApikey = process.env.ORD_APIKEY

          if (!ordId || !ordApikey) {
            throw new Error("OrderKuota credentials not configured")
          }

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

            const successfulPayment = payments.find((payment) => {
              return payment.type === "CR" && payment.qris === "static" && payment.amount == transaction.amount
            })

            if (successfulPayment) {
              const oldStatus = transaction.status
              transaction.status = "success"
              transaction.paidAt = new Date()
              transaction.paymentDetails = successfulPayment
              global.transactions.set(transactionId, transaction)
            }
          }
        } catch (apiError) {
          console.error("✗ Error checking OrderKuota API:", apiError.message)
        }
      }

      // Clean up completed transactions after a delay
      if (transaction.status !== "pending") {
        setTimeout(() => {
          if (global.transactions && global.transactions.has(transactionId)) {
            const finalTransaction = global.transactions.get(transactionId)
            if (finalTransaction.status !== "pending") {
              global.transactions.delete(transactionId)
            }
          }
        }, 60000)
      }

      // Always return current transaction status
      res.json({
        status: true,
        message: "Transaction status retrieved",
        data: transaction,
      })
    } catch (error) {
      console.error("✗ Error getting transaction status:", error.message)
      res.status(500).json({
        status: false,
        message: "Failed to get transaction status",
      })
    }
  })
}
