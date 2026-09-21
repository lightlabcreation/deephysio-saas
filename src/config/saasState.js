// In-memory state for SaaS payments demonstration
const saasState = {
  payments: [],
  
  addPayment: (payment) => {
    saasState.payments.push({
      id: `pay_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      date: new Date().toISOString(),
      customer: payment.businessName || payment.name,
      method: 'Razorpay',
      amount: `₹${(payment.amount / 100).toFixed(2)}`,
      status: 'Success',
      ...payment
    });
  },
  
  getPayments: () => {
    // Return sorted by newest
    return [...saasState.payments].sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  getRevenueStats: () => {
    let totalRevenue = 0;
    saasState.payments.forEach(p => {
      // Assuming amount is string like "₹999.00"
      const num = parseFloat(String(p.amount).replace(/[^0-9.-]+/g,""));
      totalRevenue += (num || 0);
    });

    return {
      mrr: totalRevenue,
      arr: totalRevenue * 12,
      activeSubscriptions: saasState.payments.length
    };
  }
};

module.exports = saasState;
