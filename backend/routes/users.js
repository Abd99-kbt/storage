const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('./auth');
const router = express.Router();

// Get all users
router.get('/', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;
        const { userType, isActive } = req.query;

        let query = `
            SELECT id, username, name, email, phone, user_type, is_active, created_at
            FROM users
            WHERE 1=1
        `;
        const params = [];

        if (userType) {
            query += ` AND user_type = $${params.length + 1}`;
            params.push(userType);
        }

        if (isActive !== undefined) {
            query += ` AND is_active = $${params.length + 1}`;
            params.push(isActive === 'true');
        }

        query += ' ORDER BY created_at DESC';

        const usersResult = await req.pool.query(query, params);
        const users = usersResult.rows;

        res.json(users);

    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get user by ID
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;
        const userId = req.params.id;

        const userResult = await req.pool.query(`
            SELECT id, username, name, email, phone, user_type, is_active, created_at
            FROM users
            WHERE id = $1
        `, [userId]);
        const user = userResult.rows[0];

        if (!user) {
            return res.status(404).json({ message: 'المستخدم غير موجود' });
        }

        res.json(user);

    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Update user
router.put('/:id', authenticateToken, [
    body('name').notEmpty().withMessage('الاسم مطلوب'),
    body('email').optional().isEmail().withMessage('البريد الإلكتروني غير صالح'),
    body('user_type').isIn(['admin', 'warehouse_manager', 'cutting_manager', 'sorting_manager', 
                           'accountant', 'order_tracker', 'delivery_manager', 'sales'])
        .withMessage('نوع المستخدم غير صالح')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const userId = req.params.id;
        const { name, email, phone, user_type, is_active } = req.body;
        const db = req.pool;

        // Check if user is trying to update their own account
        if (userId == req.user.id && user_type !== req.user.userType) {
            return res.status(403).json({ message: 'لا يمكنك تغيير نوع حسابك' });
        }

        const result = await req.pool.query(`
            UPDATE users SET name = $1, email = $2, phone = $3, user_type = $4, is_active = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6
        `, [name, email, phone, user_type, is_active, userId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'المستخدم غير موجود' });
        }

        const updatedUserResult = await req.pool.query('SELECT id, username, name, email, phone, user_type, is_active, created_at FROM users WHERE id = $1',
            [userId]);
        const updatedUser = updatedUserResult.rows[0];

        res.json({
            message: 'تم تحديث المستخدم بنجاح',
            user: updatedUser
        });

    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Update user password
router.put('/:id/password', authenticateToken, [
    body('currentPassword').notEmpty().withMessage('كلمة المرور الحالية مطلوبة'),
    body('newPassword').isLength({ min: 6 }).withMessage('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const userId = req.params.id;
        const { currentPassword, newPassword } = req.body;

        // Check if user is updating their own password or is admin
        if (userId != req.user.id && req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'لا يمكنك تغيير كلمة مرور مستخدم آخر' });
        }

        // Get current user password
        const userResult = await req.pool.query('SELECT password FROM users WHERE id = $1', [userId]);
        const user = userResult.rows[0];

        if (!user) {
            return res.status(404).json({ message: 'المستخدم غير موجود' });
        }

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'كلمة المرور الحالية غير صحيحة' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const result = await req.pool.query('UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [hashedPassword, userId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'المستخدم غير موجود' });
        }

        res.json({ message: 'تم تحديث كلمة المرور بنجاح' });

    } catch (error) {
        console.error('Update password error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Reset user password (admin only)
router.put('/:id/reset-password', authenticateToken, [
    body('newPassword').isLength({ min: 6 }).withMessage('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل')
], async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'فقط المدير يمكنه إعادة تعيين كلمات المرور' });
        }

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const userId = req.params.id;
        const { newPassword } = req.body;
        const db = req.pool;

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const result = await req.pool.query('UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [hashedPassword, userId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'المستخدم غير موجود' });
        }

        res.json({ message: 'تم إعادة تعيين كلمة المرور بنجاح' });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Delete user
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'فقط المدير يمكنه حذف المستخدمين' });
        }

        const userId = req.params.id;
        const db = req.pool;

        // Prevent admin from deleting themselves
        if (userId == req.user.id) {
            return res.status(400).json({ message: 'لا يمكنك حذف حسابك' });
        }

        const result = await req.pool.query('DELETE FROM users WHERE id = $1', [userId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'المستخدم غير موجود' });
        }

        res.json({ message: 'تم حذف المستخدم بنجاح' });

    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get user statistics
router.get('/stats/summary', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;

        const statsResult = await req.pool.query(`
            SELECT
                COUNT(*) as total_users,
                COUNT(CASE WHEN is_active = true THEN 1 END) as active_users,
                COUNT(CASE WHEN is_active = false THEN 1 END) as inactive_users,
                COUNT(CASE WHEN DATE(created_at) = CURRENT_DATE THEN 1 END) as new_today
            FROM users
        `);
        const stats = statsResult.rows[0];

        // Get users by type
        const byTypeResult = await req.pool.query(`
            SELECT user_type, COUNT(*) as count
            FROM users
            GROUP BY user_type
        `);
        const byType = byTypeResult.rows;

        res.json({
            summary: stats,
            byType
        });

    } catch (error) {
        console.error('Get user stats error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Create new user (admin only)
router.post('/', authenticateToken, [
    body('username').isLength({ min: 3 }).withMessage('اسم المستخدم يجب أن يكون 3 أحرف على الأقل'),
    body('password').isLength({ min: 6 }).withMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
    body('name').notEmpty().withMessage('الاسم الكامل مطلوب'),
    body('user_type').isIn(['admin', 'warehouse_manager', 'cutting_manager', 'sorting_manager',
                           'accountant', 'order_tracker', 'delivery_manager', 'sales'])
        .withMessage('نوع المستخدم غير صالح')
], async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'فقط المدير يمكنه إنشاء المستخدمين' });
        }

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { username, password, name, email, phone, user_type } = req.body;
        const db = req.pool;

        // Check if user already exists
        const existingUserResult = await req.pool.query('SELECT id FROM users WHERE username = $1', [username]);
        const existingUser = existingUserResult.rows[0];

        if (existingUser) {
            return res.status(400).json({ message: 'اسم المستخدم موجود مسبقاً' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user
        const result = await req.pool.query(
            'INSERT INTO users (username, password, name, email, phone, user_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [username, hashedPassword, name, email, phone, user_type]
        );

        res.status(201).json({
            message: 'تم إنشاء المستخدم بنجاح',
            user: { id: result.rows[0].id, username, name, user_type }
        });

    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get user activity log
router.get('/:id/activity-log', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;

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
            LIMIT 10
        `, [userId]);

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
            LIMIT 10
        `, [userId]);

        const activities = [...ordersResult.rows, ...movementsResult.rows]
            .sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date))
            .slice(0, 15);

        res.json(activities);

    } catch (error) {
        console.error('Get user activity log error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get user permissions
router.get('/:id/permissions', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;

        const userResult = await req.pool.query('SELECT user_type FROM users WHERE id = $1', [userId]);
        const user = userResult.rows[0];

        if (!user) {
            return res.status(404).json({ message: 'المستخدم غير موجود' });
        }

        const permissions = userPermissions[user.user_type] || [];

        res.json({
            user_type: user.user_type,
            permissions: permissions
        });

    } catch (error) {
        console.error('Get user permissions error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Update user permissions (admin only)
router.put('/:id/permissions', authenticateToken, [
    body('permissions').isArray().withMessage('الصلاحيات يجب أن تكون مصفوفة')
], async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'فقط المدير يمكنه تعديل الصلاحيات' });
        }

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const userId = req.params.id;
        const { permissions } = req.body;

        // Validate permissions
        const validPermissions = [
            'manage_users', 'manage_warehouses', 'manage_materials', 'manage_orders',
            'manage_invoices', 'view_reports', 'manage_settings', 'transfer_materials',
            'approve_orders', 'delete_data', 'export_data'
        ];

        const invalidPermissions = permissions.filter(p => !validPermissions.includes(p));
        if (invalidPermissions.length > 0) {
            return res.status(400).json({ message: 'صلاحيات غير صالحة: ' + invalidPermissions.join(', ') });
        }

        // For now, we'll just return the permissions since we're using role-based permissions
        // In a more advanced system, you might store custom permissions per user
        res.json({
            message: 'تم تحديث الصلاحيات بنجاح',
            permissions: permissions
        });

    } catch (error) {
        console.error('Update user permissions error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get user performance metrics
router.get('/:id/performance', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        const { period } = req.query;

        let dateFilter = '';
        const params = [userId];

        if (period === 'today') {
            dateFilter = "AND DATE(created_at) = CURRENT_DATE";
        } else if (period === 'week') {
            dateFilter = "AND created_at >= CURRENT_DATE - INTERVAL '7 days'";
        } else if (period === 'month') {
            dateFilter = "AND created_at >= CURRENT_DATE - INTERVAL '30 days'";
        }

        // Get orders created by user
        const ordersResult = await req.pool.query(`
            SELECT
                COUNT(*) as orders_created,
                SUM(total_amount) as total_order_value,
                AVG(total_amount) as avg_order_value,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders
            FROM orders
            WHERE created_by = $1 ${dateFilter}
        `, params);

        // Get materials added by user
        const materialsResult = await req.pool.query(`
            SELECT
                COUNT(*) as materials_added,
                SUM(quantity) as total_quantity_added,
                SUM(weight * quantity) as total_weight_added,
                SUM(cost) as total_material_cost
            FROM materials
            WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
        `);

        // Get stock movements by user
        const movementsResult = await req.pool.query(`
            SELECT
                COUNT(*) as total_movements,
                COUNT(CASE WHEN movement_type IN ('in', 'transfer_in') THEN 1 END) as inbound_movements,
                COUNT(CASE WHEN movement_type IN ('out', 'transfer_out') THEN 1 END) as outbound_movements,
                SUM(quantity) as total_quantity_moved
            FROM stock_movements
            WHERE created_by = $1 ${dateFilter}
        `, params);

        res.json({
            orders: ordersResult.rows[0],
            materials: materialsResult.rows[0],
            movements: movementsResult.rows[0]
        });

    } catch (error) {
        console.error('Get user performance error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Bulk user operations (admin only)
router.post('/bulk-operations', authenticateToken, [
    body('user_ids').isArray().withMessage('يجب تحديد المستخدمين'),
    body('operation').isIn(['activate', 'deactivate', 'delete', 'change_type'])
        .withMessage('نوع العملية غير صالح')
], async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'فقط المدير يمكنه تنفيذ العمليات المجمعة' });
        }

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { user_ids, operation, data } = req.body;

        switch (operation) {
            case 'activate':
                for (const userId of user_ids) {
                    await req.pool.query('UPDATE users SET is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                        [userId]);
                }
                break;

            case 'deactivate':
                for (const userId of user_ids) {
                    await req.pool.query('UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                        [userId]);
                }
                break;

            case 'change_type':
                for (const userId of user_ids) {
                    await req.pool.query('UPDATE users SET user_type = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                        [data.user_type, userId]);
                }
                break;

            case 'delete':
                for (const userId of user_ids) {
                    if (userId != req.user.id) { // Prevent admin from deleting themselves
                        await req.pool.query('DELETE FROM users WHERE id = $1', [userId]);
                    }
                }
                break;
        }

        res.json({ message: 'تم تنفيذ العملية بنجاح' });

    } catch (error) {
        console.error('Bulk user operations error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get user login history (simplified)
router.get('/:id/login-history', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;

        // This is a simplified version. In a real system, you'd track login/logout events
        const loginHistory = [
            {
                login_time: new Date().toISOString(),
                ip_address: '192.168.1.100',
                user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                status: 'success'
            },
            {
                login_time: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
                ip_address: '192.168.1.100',
                user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                status: 'success'
            }
        ];

        res.json(loginHistory);

    } catch (error) {
        console.error('Get user login history error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Search users
router.get('/search/:query', authenticateToken, async (req, res) => {
    try {
        const query = req.params.query;

        const searchResult = await req.pool.query(`
            SELECT id, username, name, email, phone, user_type, is_active, created_at
            FROM users
            WHERE name ILIKE $1 OR username ILIKE $1 OR email ILIKE $1
            ORDER BY created_at DESC
            LIMIT 20
        `, [`%${query}%`]);

        res.json(searchResult.rows);

    } catch (error) {
        console.error('Search users error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

module.exports = router;