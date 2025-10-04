# دليل تثبيت وتشغيل نظام إدارة المستودعات

## نظرة عامة
هذا الدليل يشرح خطوات تثبيت وتشغيل نظام إدارة المستودعات المتكامل مع الواجهة الخلفية.

## المتطلبات الأساسية

### برامج مطلوبة
- **Node.js**: الإصدار 14.0.0 أو أحدث
- **npm**: الإصدار 6.0.0 أو أحدث
- **PostgreSQL**: الإصدار 12.0 أو أحدث
- **Git**: للتحكم في الإصدارات (اختياري)

### متطلبات النظام
- **نظام التشغيل**: Windows, macOS, أو Linux
- **الذاكرة**: 2GB RAM كحد أدنى
- **المساحة**: 1GB مساحة خالية (لـ PostgreSQL)
- **PostgreSQL**: يتطلب تثبيت منفصل

## خطوات التثبيت

### 1. تحميل الملفات
```bash
# إذا كان لديك ملف مضغوط، قم بفك الضغط
unzip warehouse-management-system.zip

# أو إذا كنت تستخدم git
git clone [repository-url]
cd warehouse-management-system
```

### 2. إعداد قاعدة البيانات PostgreSQL

#### على Windows:
```bash
# الانتقال إلى مجلد backend
cd backend

# إنشاء قاعدة البيانات والجداول
npm run setup-db
```

#### على Linux/macOS:
```bash
# إنشاء قاعدة البيانات
createdb warehouse_management

# التأكد من صلاحيات المستخدم
psql warehouse_management -c "GRANT ALL PRIVILEGES ON DATABASE warehouse_management TO postgres;"

# أو استخدام السكريبت التلقائي
cd backend
npm run setup-db
```

### 3. تثبيت التبعيات
```bash
# الانتقال إلى مجلد الواجهة الخلفية
cd backend

# تثبيت الحزم المطلوبة (بما في ذلك pg driver)
npm install
```

### 3. إعداد المتغيرات البيئية
تحقق من وجود ملف `.env` في مجلد backend. إذا لم يكن موجوداً، أنشئه:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# JWT Configuration
JWT_SECRET=warehouse_management_system_secret_key_2025
JWT_EXPIRE=7d

# Database Configuration (PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=warehouse_management
DB_USER=postgres
DB_PASSWORD=3345016
DB_SSL=false

# Legacy SQLite path (for migration)
DB_PATH=./backend/database.sqlite

# Application Configuration
APP_NAME=نظام إدارة المستودعات
APP_URL=http://localhost:3000
```

### 4. نقل البيانات (اختياري)
إذا كان لديك بيانات في SQLite وتريد نقلها إلى PostgreSQL:
```bash
# تشغيل migration script
npm run migrate
```

### 5. تشغيل النظام

#### في وضع التطوير (Development)
```bash
# من مجلد backend
npm run dev

# أو مباشرة
node server.js
```

#### في وضع الإنتاج (Production)
```bash
# تعيين متغير البيئة
export NODE_ENV=production

# تشغيل الخادم
npm start
```

### 5. الوصول إلى النظام
بعد تشغيل الخادم، يمكنك الوصول إلى النظام عبر:
- **الواجهة الأمامية**: http://localhost:3000
- **الواجهة الخلفية API**: http://localhost:3000/api

## بيانات تسجيل الدخول التجريبية

### المستخدمين الجاهزين
| اسم المستخدم | كلمة المرور | نوع المستخدم |
|-------------|-------------|--------------|
| admin | admin123 | مدير النظام |
| warehouse1 | wh123 | أمين المستودع |
| cutting1 | cut123 | مسؤول القص |
| sorting1 | sort123 | مسؤول الفرز |
| accountant1 | acc123 | المحاسب |
| tracker1 | track123 | متابع الطلبات |
| delivery1 | del123 | مسؤول التسليم |
| sales1 | sales123 | موظف المبيعات |

## هيكل المشروع

```
warehouse-management-system/
├── backend/
│   ├── routes/          # مسارات API
│   │   ├── auth.js      # مصادقة المستخدمين
│   │   ├── warehouses.js # إدارة المستودعات
│   │   ├── materials.js  # إدارة المواد
│   │   ├── orders.js     # إدارة الطلبات
│   │   ├── invoices.js   # إدارة الفواتير
│   │   ├── reports.js    # التقارير
│   │   └── users.js      # إدارة المستخدمين
│   ├── server.js         # ملف الخادم الرئيسي
│   ├── package.json      # إعدادات المشروع
│   ├── .env             # متغيرات البيئة
│   └── database.sqlite  # قاعدة البيانات
├── index.html           # صفحة تسجيل الدخول
├── dashboard-backend.html # لوحة التحكم مع الواجهة الخلفية
├── dashboard.html       # لوحة التحكم الثابتة
├── README.md           # دليل الاستخدام
└── INSTALLATION_GUIDE.md # دليل التثبيت
```

## قاعدة البيانات

### إعداد PostgreSQL
1. تأكد من تثبيت PostgreSQL وتشغيله
2. أنشئ قاعدة بيانات جديدة:
```bash
createdb warehouse_management
```
3. تأكد من أن بيانات الاتصال في ملف `.env` صحيحة

### الجداول الرئيسية
- **users**: جدول المستخدمين
- **warehouses**: جدول المستودعات
- **materials**: جدول المواد
- **orders**: جدول الطلبات
- **order_items**: عناصر الطلبات
- **invoices**: جدول الفواتير
- **stock_movements**: حركة المخزون

### نقل البيانات من SQLite إلى PostgreSQL
```bash
# تثبيت التبعيات الجديدة
cd backend
npm install

# تشغيل migration script
npm run migrate
```

### النسخ الاحتياطي
#### لـ PostgreSQL:
```bash
# نسخة احتياطية كاملة
pg_dump warehouse_management > backup/warehouse_backup_$(date +%Y%m%d).sql

# استعادة من نسخة احتياطية
psql warehouse_management < backup/warehouse_backup_2025.sql
```

#### لـ SQLite (النسخة القديمة):
```bash
# نسخ ملف قاعدة البيانات
cp backend/database.sqlite backup/database_backup_$(date +%Y%m%d).sqlite
```

## إدارة النظام

### إعادة تعيين قاعدة البيانات
#### لـ PostgreSQL:
```bash
# حذف جميع البيانات
psql warehouse_management -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# إعادة تشغيل الخادم لإعادة إنشاء الجداول
npm run dev
```

#### لـ SQLite (قديم):
```bash
# حذف ملف قاعدة البيانات الحالية
rm backend/database.sqlite

# إعادة تشغيل الخادم لإعادة إنشاء قاعدة البيانات
npm run dev
```

### تغيير منفذ الخادم
```bash
# في ملف .env
PORT=4000

# أو عبر سطر الأوامر
PORT=4000 npm run dev
```

### تفعيل وضع التصحيح (Debug)
```bash
# في ويندوز
set DEBUG=*
npm run dev

# في macOS/Linux
export DEBUG=*
npm run dev
```

## استكشاف الأخطاء وإصلاحها

### مشاكل شائعة

#### 1. خطأ في تثبيت الحزم
```bash
# تنظيف cache npm
npm cache clean --force

# إعادة تثبيت الحزم
rm -rf node_modules
npm install
```

#### 2. الخادم لا يستجيب
- تحقق من أن المنفذ المستخدم (3000) غير مشغول
- جرب منفذاً مختلفاً
- تحقق من جدار الحماية

#### 3. خطأ في قاعدة البيانات
- **لـ PostgreSQL:**
  - تأكد من تشغيل خدمة PostgreSQL: `sudo systemctl status postgresql`
  - تحقق من بيانات الاتصال في ملف `.env`
  - تأكد من وجود قاعدة البيانات: `psql -l`
  - تحقق من صلاحيات المستخدم

- **لـ SQLite (قديم):**
  - تأكد من صلاحيات الكتابة في مجلد backend
  - تحقق من وجود مساحة كافية
  - جرب حذف قاعدة البيانات وإعادة إنشائها

#### 4. مشاكل المصادقة
- تحقق من صحة الـ JWT_SECRET في ملف .env
- تأكد من أن الوقت متزامن على الخادم
- امسح ملفات تعريف الارتباط في المتصفح

### سجلات الأخطاء
يتم تسجيل الأخطاء في وحدة التحكم. للحصول على سجلات أكثر تفصيلاً:
```bash
# في وضع التطوير
DEBUG=* npm run dev

# توجيه السجلات إلى ملف
npm run dev 2>&1 | tee server.log
```

## الأمان

### نصائح الأمان
1. **تغيير كلمات المرور الافتراضية** فوراً
2. **استخدام HTTPS** في الإنتاج
3. **تحديث الحزم بانتظام**
4. **تقييد الوصول إلى الخادم**
5. **عمل نسخ احتياطية منتظمة**

### إعداد HTTPS
```javascript
// في server.js، استبدل:
app.listen(PORT);

// بـ:
const https = require('https');
const fs = require('fs');

const options = {
    key: fs.readFileSync('path/to/private.key'),
    cert: fs.readFileSync('path/to/certificate.crt')
};

https.createServer(options, app).listen(443);
```

## الأداء

### تحسين الأداء
1. **استخدام Redis** للكاش
2. **تمكين الضغط** (compression)
3. **تحسين الاستعلامات** قاعدة البيانات
4. **استخدام CDN** للملفات الثابتة

### مراقبة الأداء
```bash
# تثبيت أدوات المراقبة
npm install --save-dev clinic

# تشغيل تحليل الأداء
npx clinic doctor -- node server.js
```

## التحديثات

### تحديث النظام
1. **أخذ نسخة احتياطية** من قاعدة البيانات
2. **تحميل الإصدار الجديد**
3. **تثبيت التحديثات**:
   ```bash
   npm update
   ```
4. **إعادة تشغيل الخادم**

### إضافة مميزات جديدة
1. **تعديل قاعدة البيانات** إذا لزم الأمر
2. **تحديث الواجهة الخلفية**
3. **تحديث الواجهة الأمامية**
4. **اختبار النظام**

## الدعم الفني

### المشكلات الشائعة
- راجع ملف `README.md` للحصول على معلومات الاستخدام
- تحقق من سجلات الأخطاء
- تأكد من توافق الإصدارات

### طلب الدعم
عند طلب الدعم، يرجى تضمين:
- إصدار Node.js
- رسائل الخطأ الكاملة
- خطوات إعادة المشكلة
- نظام التشغيل المستخدم

## الملاحظات النهائية

- تأكد من عمل نسخ احتياطية منتظمة
- حدث النظام بانتظام
- راقب استخدام الموارد
- ثبت سجلات النظام

لأية استفسارات أو مشاكل، راجع ملفات المشروع أو تواصل مع فريق الدعم.