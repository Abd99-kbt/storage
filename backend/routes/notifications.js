const express = require('express');
const router = express.Router();
const { authenticateToken } = require('./auth');

// Notification types and priorities
const NOTIFICATION_TYPES = {
    LOW_STOCK: 'low_stock',
    EXPIRED_MATERIAL: 'expired_material',
    MAINTENANCE_DUE: 'maintenance_due',
    NEW_ORDER: 'new_order',
    ORDER_COMPLETED: 'order_completed',
    INVOICE_CREATED: 'invoice_created',
    PAYMENT_RECEIVED: 'payment_received',
    WAREHOUSE_FULL: 'warehouse_full',
    SYSTEM_ALERT: 'system_alert',
    USER_MENTION: 'user_mention'
};

const NOTIFICATION_PRIORITIES = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    URGENT: 'urgent'
};

// Get user notifications
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit = 20, offset = 0, unread_only = false } = req.query;

        let query = `
            SELECT n.*, u.name as created_by_name
            FROM notifications n
            LEFT JOIN users u ON n.created_by = u.id
            WHERE n.user_id = $1
        `;
        const params = [userId];

        if (unread_only === 'true') {
            query += ' AND n.is_read = false';
        }

        query += ' ORDER BY n.created_at DESC LIMIT $2 OFFSET $3';
        params.push(parseInt(limit), parseInt(offset));

        const result = await req.pool.query(query, params);

        res.json({
            notifications: result.rows,
            total: result.rows.length,
            has_more: result.rows.length === parseInt(limit)
        });

    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Mark notification as read
router.put('/:id/read', authenticateToken, async (req, res) => {
    try {
        const notificationId = req.params.id;
        const userId = req.user.id;

        const result = await req.pool.query(
            'UPDATE notifications SET is_read = true, read_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 RETURNING *',
            [notificationId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'التنبيه غير موجود' });
        }

        res.json({ notification: result.rows[0] });

    } catch (error) {
        console.error('Mark notification read error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Mark all notifications as read
router.put('/mark-all-read', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        await req.pool.query(
            'UPDATE notifications SET is_read = true, read_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND is_read = false',
            [userId]
        );

        res.json({ message: 'تم تحديد جميع التنبيهات كمقروءة' });

    } catch (error) {
        console.error('Mark all notifications read error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get unread notifications count
router.get('/unread-count', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const result = await req.pool.query(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false',
            [userId]
        );

        res.json({ count: parseInt(result.rows[0].count) });

    } catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Delete notification
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const notificationId = req.params.id;
        const userId = req.user.id;

        const result = await req.pool.query(
            'DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING *',
            [notificationId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'التنبيه غير موجود' });
        }

        res.json({ message: 'تم حذف التنبيه بنجاح' });

    } catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Create notification (for system use)
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { user_id, title, message, type, priority = 'medium', related_id, related_type, data } = req.body;

        const result = await req.pool.query(
            `INSERT INTO notifications (user_id, title, message, type, priority, related_id, related_type, data, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [user_id, title, message, type, priority, related_id, related_type, JSON.stringify(data), req.user.id]
        );

        res.status(201).json({ notification: result.rows[0] });

    } catch (error) {
        console.error('Create notification error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get notification statistics
router.get('/stats/summary', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { period = '30' } = req.query;

        const statsResult = await req.pool.query(`
            SELECT
                COUNT(*) as total_notifications,
                COUNT(CASE WHEN is_read = false THEN 1 END) as unread_notifications,
                COUNT(CASE WHEN priority = 'high' THEN 1 END) as high_priority,
                COUNT(CASE WHEN priority = 'urgent' THEN 1 END) as urgent_notifications,
                COUNT(CASE WHEN type = 'low_stock' THEN 1 END) as low_stock_alerts,
                COUNT(CASE WHEN type = 'maintenance_due' THEN 1 END) as maintenance_alerts
            FROM notifications
            WHERE user_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '${period} days'
        `, [userId]);

        const typeStatsResult = await req.pool.query(`
            SELECT type, COUNT(*) as count, COUNT(CASE WHEN is_read = false THEN 1 END) as unread_count
            FROM notifications
            WHERE user_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '${period} days'
            GROUP BY type
            ORDER BY count DESC
        `, [userId]);

        res.json({
            summary: statsResult.rows[0],
            byType: typeStatsResult.rows
        });

    } catch (error) {
        console.error('Get notification stats error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Notification helper functions for creating system notifications
class NotificationService {
    static async createNotification(pool, { user_id, title, message, type, priority = 'medium', related_id = null, related_type = null, data = {}, created_by = null }) {
        try {
            const result = await pool.query(
                `INSERT INTO notifications (user_id, title, message, type, priority, related_id, related_type, data, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                [user_id, title, message, type, priority, related_id, related_type, JSON.stringify(data), created_by]
            );

            console.log(`Notification created: ${type} for user ${user_id}`);
            return result.rows[0];

        } catch (error) {
            console.error('Error creating notification:', error);
            throw error;
        }
    }

    static async createLowStockNotification(pool, material, created_by) {
        const title = 'تنبيه انخفاض المخزون';
        const message = `المادة "${material.name}" وصلت إلى الحد الأدنى المسموح (${material.quantity} وحدة متبقية)`;

        // Notify warehouse managers and admins
        const usersToNotify = await pool.query(`
            SELECT id FROM users
            WHERE user_type IN ('admin', 'warehouse_manager')
            AND is_active = true
        `);

        const notifications = [];
        for (const user of usersToNotify.rows) {
            const notification = await this.createNotification(pool, {
                user_id: user.id,
                title,
                message,
                type: NOTIFICATION_TYPES.LOW_STOCK,
                priority: NOTIFICATION_PRIORITIES.HIGH,
                related_id: material.id,
                related_type: 'material',
                data: { material_id: material.id, material_name: material.name, current_quantity: material.quantity },
                created_by
            });
            notifications.push(notification);
        }

        return notifications;
    }

    static async createMaintenanceNotification(pool, maintenance_request, created_by) {
        const title = 'طلب صيانة جديد';
        const message = `تم استلام طلب صيانة لـ "${maintenance_request.title}" في المستودع`;

        // Notify admins and maintenance staff
        const usersToNotify = await pool.query(`
            SELECT id FROM users
            WHERE user_type = 'admin' AND is_active = true
        `);

        const notifications = [];
        for (const user of usersToNotify.rows) {
            const notification = await this.createNotification(pool, {
                user_id: user.id,
                title,
                message,
                type: NOTIFICATION_TYPES.MAINTENANCE_DUE,
                priority: NOTIFICATION_PRIORITIES.MEDIUM,
                related_id: maintenance_request.id,
                related_type: 'maintenance',
                data: { maintenance_id: maintenance_request.id, title: maintenance_request.title },
                created_by
            });
            notifications.push(notification);
        }

        return notifications;
    }

    static async createNewOrderNotification(pool, order, created_by) {
        const title = 'طلبية جديدة';
        const message = `تم استلام طلبية جديدة رقم #${order.order_number} من ${order.customer_name}`;

        // Notify relevant staff based on order requirements
        const usersToNotify = await pool.query(`
            SELECT id FROM users
            WHERE user_type IN ('admin', 'warehouse_manager', 'cutting_manager', 'sorting_manager')
            AND is_active = true
        `);

        const notifications = [];
        for (const user of usersToNotify.rows) {
            const notification = await this.createNotification(pool, {
                user_id: user.id,
                title,
                message,
                type: NOTIFICATION_TYPES.NEW_ORDER,
                priority: NOTIFICATION_PRIORITIES.MEDIUM,
                related_id: order.id,
                related_type: 'order',
                data: { order_id: order.id, order_number: order.order_number, customer_name: order.customer_name },
                created_by
            });
            notifications.push(notification);
        }

        return notifications;
    }

    static async createInvoiceNotification(pool, invoice, created_by) {
        const title = 'فاتورة جديدة';
        const message = `تم إنشاء فاتورة جديدة رقم ${invoice.invoice_number} بقيمة ${invoice.total_amount} ليرة سورية`;

        // Notify accountants and admins
        const usersToNotify = await pool.query(`
            SELECT id FROM users
            WHERE user_type IN ('admin', 'accountant')
            AND is_active = true
        `);

        const notifications = [];
        for (const user of usersToNotify.rows) {
            const notification = await this.createNotification(pool, {
                user_id: user.id,
                title,
                message,
                type: NOTIFICATION_TYPES.INVOICE_CREATED,
                priority: NOTIFICATION_PRIORITIES.MEDIUM,
                related_id: invoice.id,
                related_type: 'invoice',
                data: { invoice_id: invoice.id, invoice_number: invoice.invoice_number, amount: invoice.total_amount },
                created_by
            });
            notifications.push(notification);
        }

        return notifications;
    }

    static async createWarehouseFullNotification(pool, warehouse, created_by) {
        const title = 'تنبيه اكتظاظ المستودع';
        const message = `المستودع "${warehouse.name}" مكتظ بنسبة ${warehouse.utilization_percentage}%`;

        // Notify warehouse managers and admins
        const usersToNotify = await pool.query(`
            SELECT id FROM users
            WHERE user_type IN ('admin', 'warehouse_manager')
            AND is_active = true
        `);

        const notifications = [];
        for (const user of usersToNotify.rows) {
            const notification = await this.createNotification(pool, {
                user_id: user.id,
                title,
                message,
                type: NOTIFICATION_TYPES.WAREHOUSE_FULL,
                priority: NOTIFICATION_PRIORITIES.HIGH,
                related_id: warehouse.id,
                related_type: 'warehouse',
                data: { warehouse_id: warehouse.id, warehouse_name: warehouse.name, utilization_percentage: warehouse.utilization_percentage },
                created_by
            });
            notifications.push(notification);
        }

        return notifications;
    }
}

// Export the service for use in other modules
module.exports = { router, NotificationService, NOTIFICATION_TYPES, NOTIFICATION_PRIORITIES };

module.exports = router;