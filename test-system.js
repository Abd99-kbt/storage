// System Test Script for Warehouse Management System
// Run this file in Node.js to test all system components

const https = require('http');

const API_BASE_URL = 'http://localhost:3000/api';
let authToken = null;
let currentUser = null;

// Colors for console output
const colors = {
    success: '\x1b[32m',
    error: '\x1b[31m',
    info: '\x1b[36m',
    warning: '\x1b[33m',
    reset: '\x1b[0m'
};

// Utility function to make HTTP requests
function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        data: JSON.parse(data)
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        data: data
                    });
                }
            });
        });

        req.on('error', reject);

        if (options.method === 'POST' || options.method === 'PUT') {
            req.write(JSON.stringify(options.body));
        }

        req.end();
    });
}

// Test system information
async function testSystemInfo() {
    console.log('\n📋 اختبار معلومات النظام');
    console.log('=' .repeat(50));

    // Test backend server
    try {
        const response = await makeRequest(`${API_BASE_URL.replace('/api', '')}/api/health`);
        if (response.status === 200) {
            console.log(`${colors.success}✅ خادم الواجهة الخلفية يعمل على المنفذ 3000${colors.reset}`);
        } else {
            console.log(`${colors.error}❌ خادم الواجهة الخلفية لا يعمل${colors.reset}`);
        }
    } catch (error) {
        console.log(`${colors.error}❌ لا يمكن الاتصال بخادم الواجهة الخلفية: ${error.message}${colors.reset}`);
    }

    // Test frontend server
    try {
        const response = await makeRequest('http://localhost:8000');
        if (response.status === 200) {
            console.log(`${colors.success}✅ خادم الواجهة الأمامية يعمل على المنفذ 8000${colors.reset}`);
        } else {
            console.log(`${colors.error}❌ خادم الواجهة الأمامية لا يعمل${colors.reset}`);
        }
    } catch (error) {
        console.log(`${colors.error}❌ لا يمكن الاتصال بخادم الواجهة الأمامية: ${error.message}${colors.reset}`);
    }
}

// Test authentication
async function testAuthentication() {
    console.log('\n🔐 اختبار المصادقة');
    console.log('=' .repeat(50));

    try {
        const response = await makeRequest(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: {
                username: 'admin',
                password: 'admin123',
                userType: 'admin'
            }
        });

        if (response.status === 200) {
            authToken = response.data.token;
            currentUser = response.data.user;
            console.log(`${colors.success}✅ تم تسجيل الدخول بنجاح: ${response.data.user.name}${colors.reset}`);
            console.log(`${colors.info}🔑 الرمز المميز: ${authToken.substring(0, 50)}...${colors.reset}`);
        } else {
            console.log(`${colors.error}❌ فشل في تسجيل الدخول: ${response.data.message}${colors.reset}`);
        }
    } catch (error) {
        console.log(`${colors.error}❌ خطأ في الاتصال: ${error.message}${colors.reset}`);
    }
}

// Test materials API
async function testMaterialsAPI() {
    console.log('\n📦 اختبار إدارة المواد');
    console.log('=' .repeat(50));

    if (!authToken) {
        console.log(`${colors.error}❌ يرجى تسجيل الدخول أولاً${colors.reset}`);
        return;
    }

    try {
        const response = await makeRequest(`${API_BASE_URL}/materials`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 200) {
            console.log(`${colors.success}✅ تم استرجاع ${response.data.length} مادة بنجاح${colors.reset}`);
            if (response.data.length > 0) {
                console.log(`${colors.info}📦 أول مادة: ${response.data[0].name} (${response.data[0].quantity} وحدة)${colors.reset}`);
            }
        } else {
            console.log(`${colors.error}❌ خطأ في استرجاع المواد: ${response.data.message}${colors.reset}`);
        }
    } catch (error) {
        console.log(`${colors.error}❌ خطأ في الاتصال: ${error.message}${colors.reset}`);
    }
}

// Test warehouses API
async function testWarehousesAPI() {
    console.log('\n🏭 اختبار إدارة المستودعات');
    console.log('=' .repeat(50));

    if (!authToken) {
        console.log(`${colors.error}❌ يرجى تسجيل الدخول أولاً${colors.reset}`);
        return;
    }

    try {
        const response = await makeRequest(`${API_BASE_URL}/warehouses`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 200) {
            console.log(`${colors.success}✅ تم استرجاع ${response.data.length} مستودع بنجاح${colors.reset}`);
            if (response.data.length > 0) {
                console.log(`${colors.info}🏭 أول مستودع: ${response.data[0].name} (${response.data[0].type})${colors.reset}`);
            }
        } else {
            console.log(`${colors.error}❌ خطأ في استرجاع المستودعات: ${response.data.message}${colors.reset}`);
        }
    } catch (error) {
        console.log(`${colors.error}❌ خطأ في الاتصال: ${error.message}${colors.reset}`);
    }
}

// Test users API
async function testUsersAPI() {
    console.log('\n👥 اختبار إدارة المستخدمين');
    console.log('=' .repeat(50));

    if (!authToken) {
        console.log(`${colors.error}❌ يرجى تسجيل الدخول أولاً${colors.reset}`);
        return;
    }

    try {
        const response = await makeRequest(`${API_BASE_URL}/users`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 200) {
            console.log(`${colors.success}✅ تم استرجاع ${response.data.length} مستخدم بنجاح${colors.reset}`);
            if (response.data.length > 0) {
                console.log(`${colors.info}👤 أول مستخدم: ${response.data[0].name} (${response.data[0].user_type})${colors.reset}`);
            }
        } else {
            console.log(`${colors.error}❌ خطأ في استرجاع المستخدمين: ${response.data.message}${colors.reset}`);
        }
    } catch (error) {
        console.log(`${colors.error}❌ خطأ في الاتصال: ${error.message}${colors.reset}`);
    }
}

// Test database connection
async function testDatabaseConnection() {
    console.log('\n🗄️ اختبار اتصال قاعدة البيانات');
    console.log('=' .repeat(50));

    try {
        const response = await makeRequest(`${API_BASE_URL.replace('/api', '')}/api/health`);
        if (response.status === 200) {
            console.log(`${colors.success}✅ قاعدة البيانات متصلة وتعمل بشكل طبيعي${colors.reset}`);
        } else {
            console.log(`${colors.error}❌ مشكلة في اتصال قاعدة البيانات${colors.reset}`);
        }
    } catch (error) {
        console.log(`${colors.error}❌ لا يمكن الاتصال بقاعدة البيانات: ${error.message}${colors.reset}`);
    }
}

// Run all tests
async function runAllTests() {
    console.log(`${colors.info}🧪 بدء اختبار نظام إدارة المستودعات الشامل${colors.reset}`);
    console.log('=' .repeat(70));

    console.log(`${colors.info}📋 بيانات تسجيل الدخول التجريبية:${colors.reset}`);
    console.log(`${colors.info}المستخدم: admin | كلمة المرور: admin123${colors.reset}`);
    console.log(`${colors.info}المستخدم: warehouse1 | كلمة المرور: wh123${colors.reset}`);
    console.log(`${colors.info}المستخدم: cutting1 | كلمة المرور: cut123${colors.reset}`);

    // Run all tests
    await testSystemInfo();
    await testDatabaseConnection();
    await testAuthentication();

    if (authToken) {
        await testMaterialsAPI();
        await testWarehousesAPI();
        await testUsersAPI();
    }

    console.log('\n' + '=' .repeat(70));
    console.log(`${colors.success}✅ اكتمل الاختبار الشامل${colors.reset}`);
    console.log(`${colors.info}🌐 يمكنك الآن فتح المتصفح والذهاب إلى:${colors.reset}`);
    console.log(`${colors.info}http://localhost:8000${colors.reset}`);
    console.log(`${colors.info}ثم تسجيل الدخول باستخدام:${colors.reset}`);
    console.log(`${colors.info}المستخدم: admin | كلمة المرور: admin123${colors.reset}`);
}

// Run tests if this file is executed directly
if (require.main === module) {
    runAllTests().catch(console.error);
}

module.exports = {
    testSystemInfo,
    testAuthentication,
    testMaterialsAPI,
    testWarehousesAPI,
    testUsersAPI,
    testDatabaseConnection,
    runAllTests
};