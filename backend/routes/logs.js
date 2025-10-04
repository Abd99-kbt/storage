const express = require('express');
const { authenticateToken } = require('./auth');
const router = express.Router();

// Get system logs (admin only)
router.get('/', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'فقط المدير يمكنه الوصول للسجلات' });
        }

        // This is a simplified version. In a real system, you'd read from log files
        const logs = [
            {
                timestamp: new Date().toISOString(),
                level: 'info',
                message: 'System started successfully',
                source: 'server',
                user_id: req.user.id,
                ip_address: req.ip
            },
            {
                timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
                level: 'warning',
                message: 'High memory usage detected',
                source: 'monitor',
                user_id: null,
                ip_address: null
            },
            {
                timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
                level: 'error',
                message: 'Database connection timeout',
                source: 'database',
                user_id: null,
                ip_address: null
            }
        ];

        res.json(logs);

    } catch (error) {
        console.error('Get logs error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get user activity logs
router.get('/user-activity', authenticateToken, async (req, res) => {
    try {
        const { user_id, limit = 50 } = req.query;

        // Get user's recent orders
        const ordersResult = await req.pool.query(`
            SELECT
                'order' as activity_type,
                o.order_number as reference,
                o.customer_name as description,
                o.created_at as activity_date,
                o.status
            FROM orders o
            WHERE o.created_by = $1
            ORDER BY o.created_at DESC
            LIMIT $2
        `, [user_id || req.user.id, limit]);

        // Get user's material movements
        const movementsResult = await req.pool.query(`
            SELECT
                'material_movement' as activity_type,
                m.name as reference,
                CONCAT('حركة: ', sm.movement_type, ' - الكمية: ', sm.quantity) as description,
                sm.created_at as activity_date,
                sm.movement_type as status
            FROM stock_movements sm
            LEFT JOIN materials m ON sm.material_id = m.id
            WHERE sm.created_by = $1
            ORDER BY sm.created_at DESC
            LIMIT $2
        `, [user_id || req.user.id, limit]);

        const activities = [...ordersResult.rows, ...movementsResult.rows]
            .sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date))
            .slice(0, parseInt(limit));

        res.json(activities);

    } catch (error) {
        console.error('Get user activity logs error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Log system event (internal use)
router.post('/event', authenticateToken, async (req, res) => {
    try {
        const { level, message, source, data } = req.body;

        // In a real system, you'd save this to a logs table or file
        console.log(`[${level.toUpperCase()}] ${source}: ${message}`, data || '');

        res.json({ message: 'تم تسجيل الحدث بنجاح' });

    } catch (error) {
        console.error('Log event error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

module.exports = router;