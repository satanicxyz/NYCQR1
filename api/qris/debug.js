// Middleware to restrict debug endpoints to development or require DEBUG_SECRET
function requireDebugAuth(req, res, next) {
  if (process.env.NODE_ENV === "production") {
    const debugSecret = process.env.DEBUG_SECRET
    const providedSecret = req.headers["x-debug-secret"]

    if (!debugSecret || providedSecret !== debugSecret) {
      return res.status(403).json({
        status: false,
        message: "Debug endpoints are disabled in production",
      })
    }
  }
  next()
}

module.exports = (app) => {
  // Debug endpoint to view all active transactions
  app.get("/api/qris/debug/transactions", requireDebugAuth, (req, res) => {
    try {
      const transactions = []

      if (global.transactions && global.transactions.size > 0) {
        for (const [transactionId, transaction] of global.transactions) {
          transactions.push({
            id: transactionId,
            amount: transaction.amount,
            originalAmount: transaction.originalAmount,
            status: transaction.status,
            createdAt: transaction.createdAt,
            expired: transaction.expired,
            wasAmountAdjusted: transaction.wasAmountAdjusted,
            amountAdjustment: transaction.amountAdjustment,
          })
        }
      }

      res.json({
        status: true,
        message: "Active transactions retrieved",
        data: {
          totalTransactions: transactions.length,
          transactions: transactions,
        },
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      console.error("✗ Error getting debug transactions:", error.message)
      res.status(500).json({
        status: false,
        message: "Failed to get transactions",
      })
    }
  })

  // Debug endpoint to manually clean up transactions
  app.post("/api/qris/debug/cleanup", requireDebugAuth, (req, res) => {
    try {
      let cleanedCount = 0
      const now = new Date()

      if (global.transactions && global.transactions.size > 0) {
        for (const [transactionId, transaction] of global.transactions) {
          // Clean up completed or expired transactions
          if (transaction.status !== "pending" || new Date(transaction.expired) < now) {
            global.transactions.delete(transactionId)
            cleanedCount++
          }
        }
      }

      res.json({
        status: true,
        message: `Cleanup completed: ${cleanedCount} transactions removed`,
        data: {
          cleanedCount: cleanedCount,
          remainingTransactions: global.transactions ? global.transactions.size : 0,
        },
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      console.error("✗ Error in manual cleanup:", error.message)
      res.status(500).json({
        status: false,
        message: "Failed to cleanup transactions",
      })
    }
  })
}
