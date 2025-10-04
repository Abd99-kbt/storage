const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const router = express.Router();

// User permissions configuration
const userPermissions = {
    admin: [
        'manage_users', 'manage_warehouses', 'manage_materials', 'manage_orders',
        'manage_invoices', 'view_reports', 'manage_settings', 'transfer_materials',
        'approve_orders', 'delete_data', 'export_data'
    ],
    warehouse_manager: [
        'manage_warehouses', 'manage_materials', 'transfer_materials', 'view_reports'
    ],
    cutting_manager: [
        'manage_materials', 'manage_orders', 'view_reports', 'approve_orders'
    ],
    sorting_manager: [
        'manage_materials', 'manage_orders', 'view_reports', 'approve_orders'
    ],
    accountant: [
        'manage_invoices', 'view_reports', 'export_data', 'manage_orders'
    ],
    order_tracker: [
        'manage_orders', 'view_reports'
    ],
    delivery_manager: [
        'manage_orders', 'manage_invoices', 'view_reports'
    ],
    sales: [
        'manage_orders', 'view_reports'
    ]
};

// Check if user has permission
function hasPermission(userType, permission) {
    return userPermissions[userType] && userPermissions[userType].includes(permission);
}

// Middleware to check permissions
function requirePermission(permission) {
    return (req, res, next) => {
        if (!hasPermission(req.user.userType, permission)) {
            return res.status(403).json({ message: 'ليس لديك صلاحية للوصول إلى هذه الوظيفة' });
        }
        next();
    };
}

// Enhanced authenticateToken middleware with permissions
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'رمز الدخول مطلوب' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'رمز الدخول غير صالح' });
        }
        req.user = user;
        next();
    });
}

// Login
router.post('/login', [
    body('username').notEmpty().withMessage('اسم المستخدم مطلوب'),
    body('password').notEmpty().withMessage('كلمة المرور مطلوبة'),
    body('userType').notEmpty().withMessage('نوع المستخدم مطلوب')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { username, password, userType } = req.body;

        // Find user
        const userResult = await req.pool.query(
            'SELECT * FROM users WHERE username = $1 AND user_type = $2',
            [username, userType]
        );
        const user = userResult.rows[0];

        if (!user) {
            return res.status(401).json({ message: 'بيانات تسجيل الدخول غير صحيحة' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'بيانات تسجيل الدخول غير صحيحة' });
        }

        // Check if user is active
        if (!user.is_active) {
            return res.status(401).json({ message: 'حسابك غير مفعّل' });
        }

        // Generate JWT token
        const payload = {
            user: {
                id: user.id,
                username: user.username,
                name: user.name,
                userType: user.user_type
            }
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                name: user.name,
                userType: user.user_type,
                email: user.email,
                phone: user.phone
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Register new user (admin only)
router.post('/register', [
    body('username').isLength({ min: 3 }).withMessage('اسم المستخدم يجب أن يكون 3 أحرف على الأقل'),
    body('password').isLength({ min: 6 }).withMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
    body('name').notEmpty().withMessage('الاسم الكامل مطلوب'),
    body('userType').notEmpty().withMessage('نوع المستخدم مطلوب')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { username, password, name, email, phone, userType } = req.body;

        // Check if user already exists
        const existingUserResult = await req.pool.query(
            'SELECT id FROM users WHERE username = $1',
            [username]
        );
        const existingUser = existingUserResult.rows[0];

        if (existingUser) {
            return res.status(400).json({ message: 'اسم المستخدم موجود مسبقاً' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user
        const result = await req.pool.query(
            'INSERT INTO users (username, password, name, email, phone, user_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [username, hashedPassword, name, email, phone, userType]
        );

        res.status(201).json({
            message: 'تم إنشاء المستخدم بنجاح',
            user: { id: result.id, username, name, userType }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const userResult = await req.pool.query(
            'SELECT id, username, name, email, phone, user_type, is_active, created_at FROM users WHERE id = $1',
            [userId]
        );
        const user = userResult.rows[0];

        if (!user) {
            return res.status(404).json({ message: 'المستخدم غير موجود' });
        }

        res.json({ user });

    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Middleware to authenticate token - Enhanced version (kept above)

module.exports = router;
module.exports.authenticateToken = authenticateToken;