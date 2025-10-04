const express = require('express');
const { authenticateToken } = require('./auth');
const router = express.Router();

// Get system settings
router.get('/', authenticateToken, async (req, res) => {
    try {
        const settings = {
            system: {
                name: 'نظام إدارة المستودعات المتقدم',
                version: '1.0.0',
                environment: process.env.NODE_ENV || 'development',
                port: process.env.PORT || 3000,
                database: {
                    host: process.env.DB_HOST || 'localhost',
                    port: process.env.DB_PORT || 5432,
                    name: process.env.DB_NAME || 'warehouse_management'
                }
            },
            features: {
                notifications: true,
                reports: true,
                export: true,
                backup: true,
                multi_warehouse: true,
                user_management: true,
                advanced_search: true,
                real_time_updates: true
            },
            limits: {
                max_materials_per_warehouse: 10000,
                max_orders_per_day: 1000,
                max_users: 100,
                session_timeout: 7 * 24 * 60 * 60 * 1000, // 7 days
                max_file_size: 10 * 1024 * 1024, // 10MB
                backup_retention_days: 30
            },
            notifications: {
                email_enabled: true,
                sms_enabled: false,
                push_enabled: true,
                low_stock_alert: true,
                order_status_change: true,
                system_maintenance: true
            },
            security: {
                password_min_length: 6,
                session_timeout: 7 * 24 * 60 * 60 * 1000,
                max_login_attempts: 5,
                lockout_duration: 15 * 60 * 1000, // 15 minutes
                require_password_change: false,
                two_factor_auth: false
            }
        };

        res.json(settings);

    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Update system settings (admin only)
router.put('/', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'فقط المدير يمكنه تحديث الإعدادات' });
        }

        const { settings } = req.body;

        if (!settings) {
            return res.status(400).json({ message: 'الإعدادات مطلوبة' });
        }

        // Validate settings structure
        const allowedSettings = ['features', 'limits', 'notifications', 'security'];
        const invalidSettings = Object.keys(settings).filter(key => !allowedSettings.includes(key));

        if (invalidSettings.length > 0) {
            return res.status(400).json({
                message: 'إعدادات غير صالحة: ' + invalidSettings.join(', ')
            });
        }

        // In a real system, you'd save these to a settings table or config file
        // For now, we'll just validate and return the settings

        res.json({
            message: 'تم تحديث الإعدادات بنجاح',
            settings: settings
        });

    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get notification settings
router.get('/notifications', authenticateToken, async (req, res) => {
    try {
        const notificationSettings = {
            email: {
                enabled: true,
                server: 'smtp.gmail.com',
                port: 587,
                secure: false,
                username: process.env.EMAIL_USER || 'your_email@gmail.com'
            },
            sms: {
                enabled: false,
                provider: '',
                api_key: ''
            },
            push: {
                enabled: true,
                title: 'نظام إدارة المستودعات',
                icon: '/favicon.ico'
            },
            alerts: {
                low_stock: {
                    enabled: true,
                    threshold: 10,
                    recipients: ['warehouse_manager', 'admin']
                },
                order_status: {
                    enabled: true,
                    events: ['pending', 'processing', 'completed'],
                    recipients: ['order_tracker', 'admin']
                },
                system_error: {
                    enabled: true,
                    recipients: ['admin']
                }
            }
        };

        res.json(notificationSettings);

    } catch (error) {
        console.error('Get notification settings error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Update notification settings (admin only)
router.put('/notifications', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'فقط المدير يمكنه تحديث إعدادات التنبيهات' });
        }

        const { settings } = req.body;

        if (!settings) {
            return res.status(400).json({ message: 'إعدادات التنبيهات مطلوبة' });
        }

        // In a real system, you'd save these to a settings table
        res.json({
            message: 'تم تحديث إعدادات التنبيهات بنجاح',
            settings: settings
        });

    } catch (error) {
        console.error('Update notification settings error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get security settings
router.get('/security', authenticateToken, async (req, res) => {
    try {
        const securitySettings = {
            password_policy: {
                min_length: 6,
                require_uppercase: false,
                require_lowercase: false,
                require_numbers: false,
                require_symbols: false,
                max_age_days: 90,
                prevent_reuse: true,
                reuse_count: 5
            },
            session_management: {
                timeout_minutes: 7 * 24 * 60, // 7 days
                extend_on_activity: true,
                max_concurrent_sessions: 5,
                require_secure_connection: false
            },
            access_control: {
                failed_login_threshold: 5,
                lockout_duration_minutes: 15,
                require_mfa: false,
                allowed_ip_ranges: [],
                blocked_ip_addresses: []
            },
            audit_logging: {
                enabled: true,
                log_user_actions: true,
                log_admin_actions: true,
                log_failed_attempts: true,
                retention_days: 90
            }
        };

        res.json(securitySettings);

    } catch (error) {
        console.error('Get security settings error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Update security settings (admin only)
router.put('/security', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'فقط المدير يمكنه تحديث إعدادات الأمان' });
        }

        const { settings } = req.body;

        if (!settings) {
            return res.status(400).json({ message: 'إعدادات الأمان مطلوبة' });
        }

        // In a real system, you'd save these to a settings table
        res.json({
            message: 'تم تحديث إعدادات الأمان بنجاح',
            settings: settings
        });

    } catch (error) {
        console.error('Update security settings error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Test system configuration
router.post('/test', authenticateToken, async (req, res) => {
    try {
        const testResults = {
            database: false,
            email: false,
            storage: false,
            external_apis: false
        };

        // Test database connection
        try {
            await req.pool.query('SELECT 1');
            testResults.database = true;
        } catch (error) {
            testResults.database = false;
        }

        // Test email configuration (simplified)
        if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
            testResults.email = true;
        }

        // Test file system
        const fs = require('fs');
        try {
            fs.accessSync('./uploads', fs.constants.W_OK);
            testResults.storage = true;
        } catch (error) {
            testResults.storage = false;
        }

        const allTestsPassed = Object.values(testResults).every(result => result === true);

        res.json({
            success: allTestsPassed,
            results: testResults,
            message: allTestsPassed ? 'جميع الاختبارات نجحت' : 'بعض الاختبارات فشلت'
        });

    } catch (error) {
        console.error('Test system configuration error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Reset settings to default (admin only)
router.post('/reset', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'فقط المدير يمكنه إعادة تعيين الإعدادات' });
        }

        // Reset to default settings
        const defaultSettings = {
            system: {
                name: 'نظام إدارة المستودعات المتقدم',
                version: '1.0.0',
                environment: process.env.NODE_ENV || 'development',
                port: process.env.PORT || 3000
            },
            features: {
                notifications: true,
                reports: true,
                export: true,
                backup: true,
                multi_warehouse: true,
                user_management: true,
                advanced_search: true,
                real_time_updates: true
            },
            limits: {
                max_materials_per_warehouse: 10000,
                max_orders_per_day: 1000,
                max_users: 100,
                session_timeout: 7 * 24 * 60 * 60 * 1000,
                max_file_size: 10 * 1024 * 1024,
                backup_retention_days: 30
            },
            notifications: {
                email_enabled: true,
                sms_enabled: false,
                push_enabled: true,
                low_stock_alert: true,
                order_status_change: true,
                system_maintenance: true
            },
            security: {
                password_min_length: 6,
                session_timeout: 7 * 24 * 60 * 60 * 1000,
                max_login_attempts: 5,
                lockout_duration: 15 * 60 * 1000,
                require_password_change: false,
                two_factor_auth: false
            }
        };

        res.json({
            message: 'تم إعادة تعيين الإعدادات إلى القيم الافتراضية',
            settings: defaultSettings
        });

    } catch (error) {
        console.error('Reset settings error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

module.exports = router;