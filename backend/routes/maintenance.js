const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('./auth');
const router = express.Router();

// Create maintenance request
router.post('/', authenticateToken, [
    body('warehouse_id').isNumeric().withMessage('رقم المستودع مطلوب'),
    body('title').notEmpty().withMessage('عنوان الطلب مطلوب'),
    body('description').notEmpty().withMessage('وصف المشكلة مطلوب'),
    body('priority').isIn(['low', 'medium', 'high', 'urgent']).withMessage('أولوية غير صالحة')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { warehouse_id, title, description, priority, scheduled_date, estimated_cost } = req.body;
        const userId = req.user.id;

        const result = await req.pool.query(`
            INSERT INTO maintenance_requests (warehouse_id, title, description, priority, scheduled_date, estimated_cost, requested_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
        `, [warehouse_id, title, description, priority, scheduled_date, estimated_cost, userId]);

        res.status(201).json({
            message: 'تم إرسال طلب الصيانة بنجاح',
            requestId: result.rows[0].id
        });

    } catch (error) {
        console.error('Create maintenance request error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get all maintenance requests
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { status, warehouse_id, priority } = req.query;

        let whereClause = "WHERE 1=1";
        const params = [];

        if (status) {
            whereClause += ` AND mr.status = $${params.length + 1}`;
            params.push(status);
        }

        if (warehouse_id) {
            whereClause += ` AND mr.warehouse_id = $${params.length + 1}`;
            params.push(warehouse_id);
        }

        if (priority) {
            whereClause += ` AND mr.priority = $${params.length + 1}`;
            params.push(priority);
        }

        let query = `
            SELECT mr.*, w.name as warehouse_name, u1.name as requested_by_name, u2.name as assigned_to_name
            FROM maintenance_requests mr
            LEFT JOIN warehouses w ON mr.warehouse_id = w.id
            LEFT JOIN users u1 ON mr.requested_by = u1.id
            LEFT JOIN users u2 ON mr.assigned_to = u2.id
            ${whereClause}
        `;

        query += ' ORDER BY mr.created_at DESC';

        const requestsResult = await req.pool.query(query, params);
        const requests = requestsResult.rows;

        res.json(requests);

    } catch (error) {
        console.error('Get maintenance requests error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Update maintenance request status
router.put('/:id/status', authenticateToken, [
    body('status').isIn(['pending', 'in_progress', 'completed', 'cancelled']).withMessage('حالة غير صالحة'),
    body('notes').optional()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const requestId = req.params.id;
        const { status, notes, actual_cost } = req.body;
        const userId = req.user.id;

        let updateFields = ['status = $1', 'updated_at = CURRENT_TIMESTAMP'];
        let values = [status];
        let paramCount = 2;

        if (notes) {
            updateFields.push(`notes = $${paramCount}`);
            values.push(notes);
            paramCount++;
        }

        if (actual_cost) {
            updateFields.push(`actual_cost = $${paramCount}`);
            values.push(actual_cost);
            paramCount++;
        }

        if (status === 'completed') {
            updateFields.push(`completed_date = CURRENT_TIMESTAMP`);
        }

        values.push(requestId);

        const result = await req.pool.query(`
            UPDATE maintenance_requests
            SET ${updateFields.join(', ')}
            WHERE id = $${paramCount}
        `, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'طلب الصيانة غير موجود' });
        }

        res.json({ message: 'تم تحديث حالة طلب الصيانة بنجاح' });

    } catch (error) {
        console.error('Update maintenance request error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Assign maintenance request
router.put('/:id/assign', authenticateToken, [
    body('assigned_to').isNumeric().withMessage('رقم الموظف المكلف مطلوب')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const requestId = req.params.id;
        const { assigned_to } = req.body;

        const result = await req.pool.query(`
            UPDATE maintenance_requests
            SET assigned_to = $1, status = 'in_progress', updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [assigned_to, requestId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'طلب الصيانة غير موجود' });
        }

        res.json({ message: 'تم تعيين طلب الصيانة بنجاح' });

    } catch (error) {
        console.error('Assign maintenance request error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get maintenance statistics
router.get('/stats/summary', authenticateToken, async (req, res) => {
    try {
        const statsResult = await req.pool.query(`
            SELECT
                COUNT(*) as total_requests,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_requests,
                COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_requests,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_requests,
                COUNT(CASE WHEN priority = 'urgent' THEN 1 END) as urgent_requests,
                AVG(CASE WHEN completed_date IS NOT NULL THEN EXTRACT(EPOCH FROM (completed_date - created_at))/3600 END) as avg_resolution_hours
            FROM maintenance_requests
            WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
        `);

        const stats = statsResult.rows[0];

        // Get requests by priority
        const priorityResult = await req.pool.query(`
            SELECT priority, COUNT(*) as count
            FROM maintenance_requests
            WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY priority
        `);

        res.json({
            summary: stats,
            byPriority: priorityResult.rows
        });

    } catch (error) {
        console.error('Get maintenance stats error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

module.exports = router;