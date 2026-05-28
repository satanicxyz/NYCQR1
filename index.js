require("dotenv").config()
const express = require("express")
const chalk = require("chalk")
const fs = require("fs")
const cors = require("cors")
const path = require("path")
const rateLimit = require("express-rate-limit")

const app = express()
const PORT = process.env.PORT || 3000

// Trust only first proxy (e.g. Vercel, Nginx)
app.set("trust proxy", 1)
app.set("json spaces", 2)

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: false, message: "Too many requests, please try again later." },
})

const createLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 QRIS creations per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: false, message: "Too many payment requests, please try again later." },
})

// CORS configuration - restrict to known origins
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : []

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.) or from allowed origins
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error("Not allowed by CORS"))
    }
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}

// Middleware
app.use(express.json({ limit: "1mb" }))
app.use(express.urlencoded({ extended: false }))
app.use(cors(corsOptions))
app.use("/api/", apiLimiter)
app.use("/api/qris/create", createLimiter)

// Static file serving - only serve public assets, NOT the root directory
app.use("/style", express.static(path.join(__dirname, "style")))

// Global variables
global.transactions = global.transactions || new Map()
global.totalreq = 0

// Cleanup function for expired transactions
function cleanupExpiredTransactions() {
  if (!global.transactions || global.transactions.size === 0) {
    return
  }

  const now = new Date()
  let cleanedCount = 0

  for (const [transactionId, transaction] of global.transactions) {
    const expiredTime = new Date(transaction.expired)

    // Clean up transactions that are expired for more than 5 minutes
    if (now > expiredTime && now - expiredTime > 5 * 60 * 1000) {
      global.transactions.delete(transactionId)
      cleanedCount++
      console.log("▷ Auto-cleaned expired transaction:", transactionId)
    }
  }

  if (cleanedCount > 0) {
    console.log("▶ Auto-cleanup completed:", cleanedCount, "transactions removed")
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredTransactions, 5 * 60 * 1000)
console.log("▶ Auto-cleanup scheduler started (every 5 minutes)")

// Middleware untuk log dan format JSON response
app.use((req, res, next) => {
  console.log(chalk.bgHex("#FFFF99").hex("#333").bold(` ▶ Request Route: ${req.path} `))
  global.totalreq += 1

  const originalJson = res.json
  res.json = function (data) {
    if (data && typeof data === "object") {
      const responseData = {
        status: data.status,
        creator: "Created Using Skyzo - @krsna_081",
        ...data,
      }
      return originalJson.call(this, responseData)
    }
    return originalJson.call(this, data)
  }

  next()
})

// Load dynamic routes
let totalRoutes = 0
const apiFolder = path.join(__dirname, "./api")

if (fs.existsSync(apiFolder)) {
  fs.readdirSync(apiFolder).forEach((subfolder) => {
    const subfolderPath = path.join(apiFolder, subfolder)
    if (fs.statSync(subfolderPath).isDirectory()) {
      fs.readdirSync(subfolderPath).forEach((file) => {
        const filePath = path.join(subfolderPath, file)
        if (path.extname(file) === ".js") {
          require(filePath)(app)
          totalRoutes++
          console.log(
            chalk
              .bgHex("#FFFF99")
              .hex("#333")
              .bold(` ▶ Loaded Route: ${path.basename(file)} `),
          )
        }
      })
    }
  })
}

console.log(chalk.bgHex("#90EE90").hex("#333").bold(" ✓ Load Complete! "))
console.log(chalk.bgHex("#90EE90").hex("#333").bold(` ▶ Total Routes Loaded: ${totalRoutes} `))

// SIMPLIFIED ROUTING - All routes serve index.html (SPA)
app.get("/docs", (req, res) => {
  res.sendFile(path.join(__dirname, "docs.html"))
})
app.get("*", (req, res) => {
  // If it's an API route, let it 404
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      status: false,
      message: "API endpoint not found",
    })
  }

  // For all other routes, serve the main page (SPA behavior)
  res.sendFile(path.join(__dirname, "index.html"))
})

// Start server
app.listen(PORT, () => {
  console.log(chalk.bgHex("#90EE90").hex("#333").bold(` ▶ Server is running on port ${PORT} `))
  console.log(
    chalk
      .bgHex("#87CEEB")
      .hex("#333")
      .bold(` ▶ Environment loaded: ${process.env.NODE_ENV || "development"} `),
  )
})

module.exports = app
