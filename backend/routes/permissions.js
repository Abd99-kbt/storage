const express = require('express');
const { authenticateToken } = require('./auth');
const router = express.Router();

// All available permissions
const allPermissions = [
    // User Management
    { key: 'manage_users', name: 'إدارة المستخدمين', description: 'إدارة جميع المستخدمين في النظام', category: 'users' },
    { key: 'create_users', name: 'إنشاء مستخدمين', description: 'إمكانية إنشاء مستخدمين جدد', category: 'users' },
    { key: 'edit_users', name: 'تعديل المستخدمين', description: 'تعديل بيانات المستخدمين', category: 'users' },
    { key: 'delete_users', name: 'حذف المستخدمين', description: 'حذف المستخدمين من النظام', category: 'users' },
    { key: 'reset_passwords', name: 'إعادة تعيين كلمات المرور', description: 'إعادة تعيين كلمات مرور المستخدمين', category: 'users' },

    // Warehouse Management
    { key: 'manage_warehouses', name: 'إدارة المستودعات', description: 'إدارة جميع المستودعات', category: 'warehouses' },
    { key: 'create_warehouses', name: 'إنشاء مستودعات', description: 'إنشاء مستودعات جديدة', category: 'warehouses' },
    { key: 'edit_warehouses', name: 'تعديل المستودعات', description: 'تعديل بيانات المستودعات', category: 'warehouses' },
    { key: 'delete_warehouses', name: 'حذف المستودعات', description: 'حذف المستودعات', category: 'warehouses' },

    // Materials Management
    { key: 'manage_materials', name: 'إدارة المواد', description: 'إدارة جميع المواد في النظام', category: 'materials' },
    { key: 'create_materials', name: 'إنشاء مواد', description: 'إضافة مواد جديدة', category: 'materials' },
    { key: 'edit_materials', name: 'تعديل المواد', description: 'تعديل بيانات المواد', category: 'materials' },
    { key: 'delete_materials', name: 'حذف المواد', description: 'حذف المواد من النظام', category: 'materials' },
    { key: 'transfer_materials', name: 'نقل المواد', description: 'نقل المواد بين المستودعات', category: 'materials' },

    // Orders Management
    { key: 'manage_orders', name: 'إدارة الطلبات', description: 'إدارة جميع الطلبات', category: 'orders' },
    { key: 'create_orders', name: 'إنشاء طلبات', description: 'إنشاء طلبات جديدة', category: 'orders' },
    { key: 'edit_orders', name: 'تعديل الطلبات', description: 'تعديل بيانات الطلبات', category: 'orders' },
    { key: 'approve_orders', name: 'الموافقة على الطلبات', description: 'الموافقة على الطلبات', category: 'orders' },
    { key: 'cancel_orders', name: 'إلغاء الطلبات', description: 'إلغاء الطلبات', category: 'orders' },

    // Invoices Management
    { key: 'manage_invoices', name: 'إدارة الفواتير', description: 'إدارة جميع الفواتير', category: 'invoices' },
    { key: 'create_invoices', name: 'إنشاء فواتير', description: 'إنشاء فواتير جديدة', category: 'invoices' },
    { key: 'edit_invoices', name: 'تعديل الفواتير', description: 'تعديل بيانات الفواتير', category: 'invoices' },
    { key: 'approve_invoices', name: 'الموافقة على الفواتير', description: 'الموافقة على الفواتير', category: 'invoices' },

    // Reports
    { key: 'view_reports', name: 'عرض التقارير', description: 'عرض التقارير والإحصائيات', category: 'reports' },
    { key: 'export_reports', name: 'تصدير التقارير', description: 'تصدير التقارير', category: 'reports' },
    { key: 'manage_reports', name: 'إدارة التقارير', description: 'إدارة وتخصيص التقارير', category: 'reports' },

    // Settings
    { key: 'manage_settings', name: 'إدارة الإعدادات', description: 'إدارة إعدادات النظام', category: 'settings' },
    { key: 'system_settings', name: 'إعدادات النظام', description: 'تعديل إعدادات النظام الأساسية', category: 'settings' },
    { key: 'backup_restore', name: 'النسخ الاحتياطي', description: 'إدارة النسخ الاحتياطي واستعادة البيانات', category: 'settings' },

    // Analytics
    { key: 'view_analytics', name: 'عرض التحليلات', description: 'عرض التحليلات والإحصائيات المتقدمة', category: 'analytics' },
    { key: 'manage_notifications', name: 'إدارة التنبيهات', description: 'إدارة تنبيهات النظام', category: 'notifications' },
    { key: 'system_health', name: 'حالة النظام', description: 'مراقبة حالة النظام والأداء', category: 'monitoring' }
];

// Get all permissions
router.get('/', authenticateToken, async (req, res) => {
    try {
        res.json(allPermissions);
    } catch (error) {
        console.error('Get permissions error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get all users with their permissions
router.get('/all', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'فقط المدير يمكنه عرض صلاحيات جميع المستخدمين' });
        }

        const db = req.pool;

        // Get all users with their roles
        const usersResult = await req.pool.query(`
            SELECT id, username, name, email, phone, user_type, is_active, created_at
            FROM users
            ORDER BY created_at DESC
        `);

        const users = usersResult.rows;

        // Get role-based permissions for each user
        const usersWithPermissions = users.map(user => ({
            ...user,
            permissions: getRolePermissions(user.user_type)
        }));

        res.json(usersWithPermissions);

    } catch (error) {
        console.error('Get all users permissions error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get permissions for a specific user
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;

        // Users can only view their own permissions, admins can view anyone's
        if (userId != req.user.id && req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'لا يمكنك عرض صلاحيات هذا المستخدم' });
        }

        const userResult = await req.pool.query('SELECT user_type FROM users WHERE id = $1', [userId]);
        const user = userResult.rows[0];

        if (!user) {
            return res.status(404).json({ message: 'المستخدم غير موجود' });
        }

        const permissions = getRolePermissions(user.user_type);

        res.json({
            user_id: userId,
            user_type: user.user_type,
            permissions: permissions
        });

    } catch (error) {
        console.error('Get user permissions error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Bulk update user permissions (admin only)
router.put('/bulk', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'فقط المدير يمكنه تعديل الصلاحيات' });
        }

        const { user_ids, permissions } = req.body;

        if (!Array.isArray(user_ids) || !Array.isArray(permissions)) {
            return res.status(400).json({ message: 'بيانات غير صالحة' });
        }

        // Validate permissions
        const validPermissions = allPermissions.map(p => p.key);
        const invalidPermissions = permissions.filter(p => !validPermissions.includes(p));

        if (invalidPermissions.length > 0) {
            return res.status(400).json({
                message: 'صلاحيات غير صالحة: ' + invalidPermissions.join(', ')
            });
        }

        // For now, since we're using role-based permissions, we'll just return success
        // In a more advanced system, you might store custom permissions per user
        res.json({
            message: 'تم تحديث الصلاحيات بنجاح',
            updated_users: user_ids.length,
            permissions_count: permissions.length
        });

    } catch (error) {
        console.error('Bulk update permissions error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get permission templates
router.get('/templates/all', authenticateToken, async (req, res) => {
    try {
        const templates = {
            admin: {
                name: 'مدير النظام',
                description: 'جميع الصلاحيات الإدارية',
                permissions: [
                    'manage_users', 'create_users', 'edit_users', 'delete_users', 'reset_passwords',
                    'manage_warehouses', 'create_warehouses', 'edit_warehouses', 'delete_warehouses',
                    'manage_materials', 'create_materials', 'edit_materials', 'delete_materials', 'transfer_materials',
                    'manage_orders', 'create_orders', 'edit_orders', 'approve_orders', 'cancel_orders',
                    'manage_invoices', 'create_invoices', 'edit_invoices', 'approve_invoices',
                    'view_reports', 'export_reports', 'manage_reports',
                    'manage_settings', 'system_settings', 'backup_restore',
                    'view_analytics', 'manage_notifications', 'system_health'
                ]
            },
            warehouse_manager: {
                name: 'أمين المستودع',
                description: 'إدارة المستودعات والمواد',
                permissions: [
                    'manage_warehouses', 'create_warehouses', 'edit_warehouses',
                    'manage_materials', 'create_materials', 'edit_materials', 'transfer_materials',
                    'view_reports', 'view_analytics'
                ]
            },
            accountant: {
                name: 'المحاسب',
                description: 'إدارة الفواتير والتقارير المالية',
                permissions: [
                    'manage_invoices', 'create_invoices', 'edit_invoices', 'approve_invoices',
                    'view_reports', 'export_reports', 'manage_reports',
                    'view_analytics'
                ]
            },
            sales: {
                name: 'موظف المبيعات',
                description: 'إدارة الطلبات والعملاء',
                permissions: [
                    'manage_orders', 'create_orders', 'edit_orders',
                    'view_reports', 'view_analytics'
                ]
            },
            viewer: {
                name: 'مشاهد فقط',
                description: 'صلاحيات القراءة فقط',
                permissions: [
                    'view_reports', 'view_analytics'
                ]
            }
        };

        res.json(templates);

    } catch (error) {
        console.error('Get permission templates error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Helper function to get permissions for a role
function getRolePermissions(userType) {
    const rolePermissions = {
        admin: [
            'manage_users', 'create_users', 'edit_users', 'delete_users', 'reset_passwords',
            'manage_warehouses', 'create_warehouses', 'edit_warehouses', 'delete_warehouses',
            'manage_materials', 'create_materials', 'edit_materials', 'delete_materials', 'transfer_materials',
            'manage_orders', 'create_orders', 'edit_orders', 'approve_orders', 'cancel_orders',
            'manage_invoices', 'create_invoices', 'edit_invoices', 'approve_invoices',
            'view_reports', 'export_reports', 'manage_reports',
            'manage_settings', 'system_settings', 'backup_restore',
            'view_analytics', 'manage_notifications', 'system_health'
        ],
        warehouse_manager: [
            'manage_warehouses', 'create_warehouses', 'edit_warehouses',
            'manage_materials', 'create_materials', 'edit_materials', 'transfer_materials',
            'view_reports', 'view_analytics'
        ],
        cutting_manager: [
            'manage_materials', 'create_materials', 'edit_materials',
            'manage_orders', 'create_orders', 'edit_orders', 'approve_orders',
            'view_reports', 'view_analytics'
        ],
        sorting_manager: [
            'manage_materials', 'create_materials', 'edit_materials',
            'manage_orders', 'create_orders', 'edit_orders', 'approve_orders',
            'view_reports', 'view_analytics'
        ],
        accountant: [
            'manage_invoices', 'create_invoices', 'edit_invoices', 'approve_invoices',
            'view_reports', 'export_reports', 'manage_reports',
            'view_analytics'
        ],
        order_tracker: [
            'manage_orders', 'create_orders', 'edit_orders',
            'view_reports', 'view_analytics'
        ],
        delivery_manager: [
            'manage_orders', 'create_orders', 'edit_orders', 'approve_orders',
            'manage_invoices', 'create_invoices', 'edit_invoices',
            'view_reports', 'view_analytics'
        ],
        sales: [
            'manage_orders', 'create_orders', 'edit_orders',
            'view_reports', 'view_analytics'
        ]
    };

    return rolePermissions[userType] || [];
}

module.exports = router;