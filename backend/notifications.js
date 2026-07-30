const nodemailer = require('nodemailer');
const config = require('./config');

function isSmtpConfigured() {
  return !!(
    config.smtpHost &&
    config.smtpPort &&
    config.smtpUser &&
    config.smtpPassword &&
    config.smtpFromEmail
  );
}

// Cached SMTP transporter (created once, reused)
let cachedTransporter = null;
function getTransporter() {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPassword
      }
    });
  }
  return cachedTransporter;
}

async function sendEmail(toEmail, subject, htmlContent, textContent) {
  if (!isSmtpConfigured()) {
    console.log(`--- [SMTP Fallback Log] ---`);
    console.log(`To: ${toEmail}`);
    console.log(`Subject: ${subject}`);
    console.log(`Plain Text:\n${textContent}`);
    console.log(`---------------------------`);
    return true;
  }

  try {
    const transporter = getTransporter();

    const info = await transporter.sendMail({
      from: config.smtpFromEmail,
      to: toEmail,
      subject: subject,
      text: textContent,
      html: htmlContent
    });

    console.log(`Successfully sent email to ${toEmail}:`, info.messageId);
    return true;
  } catch (e) {
    console.error(`Failed to send email to ${toEmail}:`, e.message);
    // Reset transporter on error so next attempt creates a fresh connection
    cachedTransporter = null;
    return false;
  }
}

async function sendMatchNotification(toEmail, userId, matchData) {
  const id = matchData.id;
  const title = matchData.title || 'Job Vacancy';
  const company = matchData.company || 'Employer';
  const url = matchData.url || '#';
  const score = matchData.score || 0;
  const reasoning = matchData.reasoning || '';

  const subject = `🎯 [HH4YOU] Подходящая вакансия! ${score}%: ${title} в ${company}`;
  const dashboardUrl = config.baseUrl || 'http://localhost:8000';
  const viewLetterUrl = `${dashboardUrl}/?matchId=${id}`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333333; background-color: #f4f6fa; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
            .header { border-bottom: 2px solid #8b5cf6; padding-bottom: 15px; margin-bottom: 20px; text-align: center; }
            .logo { font-size: 24px; font-weight: bold; color: #8b5cf6; text-decoration: none; }
            .badge { display: inline-block; background-color: #8b5cf6; color: #ffffff; padding: 5px 12px; border-radius: 20px; font-weight: bold; font-size: 14px; margin-top: 10px; }
            .job-details { background-color: #f8fafc; border-left: 4px solid #8b5cf6; padding: 15px; margin-bottom: 25px; border-radius: 0 8px 8px 0; }
            .job-title { font-size: 18px; margin: 0 0 5px 0; font-weight: bold; color: #1e293b; }
            .company-name { font-size: 14px; color: #64748b; margin: 0 0 10px 0; }
            .btn { display: inline-block; background: #8b5cf6; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 10px; }
            .btn-green { display: inline-block; background: #10b981; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 10px; }
            .section-title { font-size: 16px; font-weight: bold; color: #1e293b; margin: 20px 0 10px 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; }
            .reasoning { font-style: italic; color: #475569; }
            .footer { margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px; font-size: 11px; color: #94a3b8; text-align: center; }
            .footer a { color: #8b5cf6; text-decoration: none; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <a href="${dashboardUrl}" class="logo" style="color: #8b5cf6 !important; text-decoration: none;">HH4YOU</a><br/>
                <span class="badge">Совпадение ${score}%</span>
            </div>
            
            <div class="job-details">
                <p class="job-title">${title}</p>
                <p class="company-name">${company}</p>
                <div style="margin-top: 10px;">
                    <a href="${url}" class="btn" target="_blank" style="color: #ffffff !important; text-decoration: none; margin-right: 8px;">Посмотреть Вакансию</a>
                    <a href="${viewLetterUrl}" class="btn-green" target="_blank" style="color: #ffffff !important; text-decoration: none; background-color: #10b981 !important;">Сопроводительное письмо</a>
                </div>
            </div>
 
            <div class="section-title">Комментарий от ИИ</div>
            <p class="reasoning">${reasoning}</p>
 
            <div class="footer">
                Это электронное письмо было отправлено вам поисковой системой HH4YOU.<br/>
                Отключить рассылу можно в <a href="${dashboardUrl}" style="color: #8b5cf6 !important;">настройках</a>.
            </div>
        </div>
    </body>
    </html>
  `;

  const textContent = `
    HH4YOU Уведомление!
    Совпадение: ${score}%
    
    Вакансия: ${title}
    Компания: ${company}
    Ссылка: ${url}
    
    Коментарий от ИИ:
    ${reasoning}
    
    Посмотреть и скопировать сопроводительное письмо: ${viewLetterUrl}
    
    Изменить настройки уведомлений: ${dashboardUrl}
  `;

  return await sendEmail(toEmail, subject, htmlContent, textContent);
}

async function sendBillingWarning(toEmail, warningType, daysLeft) {
  const isTrial = warningType === 'trial';
  const warningTypeRu = isTrial ? 'пробный период' : 'подписка';
  const subject = `⚠️ [HH4YOU] Внимание: Ваш ${warningTypeRu} заканчивается через ${daysLeft} дня!`;
  const dashboardUrl = config.baseUrl || 'http://localhost:8000';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333333; background-color: #f4f6fa; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
            .header { border-bottom: 2px solid #ef4444; padding-bottom: 15px; margin-bottom: 20px; text-align: center; }
            .logo { font-size: 24px; font-weight: bold; color: #ef4444; text-decoration: none; }
            .content { text-align: center; padding: 20px 0; }
            .warning-text { font-size: 18px; color: #1e293b; margin-bottom: 15px; }
            .btn { display: inline-block; background: #ef4444; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 15px; }
            .footer { margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px; font-size: 11px; color: #94a3b8; text-align: center; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <a href="${dashboardUrl}" class="logo" style="color: #ef4444 !important; text-decoration: none;">HH4YOU оповещение</a>
            </div>
            <div class="content">
                <p class="warning-text">Ваш <b>${warningTypeRu}</b> скоро закончится!</p>
                <p>Только <b>${daysLeft} дня</b> осталось до того, как деактивируется поиск вакансий для вас.</p>
                <p>Чтобы избежать каких-либо сбоев в поиске работы вашей мечты и рассылке уведомленний, пожалуйста, ${isTrial ? 'оформите подписку' : 'продлите вашу подписку'}.</p>
                <a href="${dashboardUrl}" class="btn" style="color: #ffffff !important; text-decoration: none;">${isTrial ? 'Оформить подписку сейчас' : 'Продлить подписку сейчас'}</a>
            </div>
            <div class="footer">
                Отправлено автоматически от HH4YOU.
            </div>
        </div>
    </body>
    </html>
  `;

  const textContent = `
    HH4YOU: заканчивается ${warningTypeRu}!
    
    Ваш ${warningTypeRu} заканчивается через ${daysLeft} дня!
    Ваше автоматическое сканирование вакансий и конвейер подбора будут отключены, если вы не ${isTrial ? 'оформите подписку' : 'продлите свою подписку'}.
    
    Пожалуйста, посетите свой личный кабинет, чтобы обновить статус: ${dashboardUrl}
  `;

  return await sendEmail(toEmail, subject, htmlContent, textContent);
}

async function sendWelcomeEmail(toEmail) {
  const subject = '🎉 Добро пожаловать в HH4YOU! Ваша подписка активна';
  const dashboardUrl = config.baseUrl || 'http://localhost:8000';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333333; background-color: #f4f6fa; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
            .header { border-bottom: 2px solid #8b5cf6; padding-bottom: 15px; margin-bottom: 20px; text-align: center; }
            .logo { font-size: 28px; font-weight: bold; color: #8b5cf6; }
            .badge { display: inline-block; background: #10b981; color: #fff; padding: 6px 16px; border-radius: 20px; font-weight: bold; font-size: 14px; margin-top: 8px; }
            .section { background: #f8fafc; border-left: 4px solid #8b5cf6; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0; }
            .warning { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0; }
            .warning-title { font-weight: bold; color: #92400e; margin: 0 0 8px 0; }
            h2 { color: #1e293b; }
            .btn { display: inline-block; background: #8b5cf6; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 15px; }
            .footer { margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px; font-size: 11px; color: #94a3b8; text-align: center; }
            ul { padding-left: 20px; }
            li { margin-bottom: 8px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">HH4YOU</div>
                <div class="badge">Подписка активна</div>
            </div>

            <h2>Добро пожаловать!</h2>
            <p>Ваш аккаунт создан и подписка активна. HH4YOU уже начинает поиск подходящих вакансий по вашему резюме.</p>

            <div class="section">
                <strong>Что происходит прямо сейчас:</strong>
                <ul>
                    <li>🔍 ИИ ищет вакансии на HH.ru, Habr Career и SuperJob</li>
                    <li>🎯 Каждая вакансия оценивается по соответствию вашему опыту</li>
                    <li>✉️ Подходящие вакансии будут приходить на этот email</li>
                </ul>
            </div>

            <div class="warning">
                <p class="warning-title">⚠️ Важно: письма могут попасть в спам</p>
                <p>Первые уведомления о вакансиях могут оказаться в папке «Спам» или «Рассылки». Пожалуйста, найдите наше письмо и отметьте его как <strong>«Не спам»</strong> — тогда все следующие письма будут приходить в ваш inbox.</p>
            </div>

            <p>Ваше резюме уже загружено и обработано. Ничего дополнительно делать не нужно — просто ждите уведомлений о новых вакансиях.</p>

            <a href="${dashboardUrl}" class="btn" style="color: #ffffff !important; text-decoration: none;">Открыть личный кабинет</a>

            <div class="footer">
                Это письмо отправлено автоматически сервисом HH4YOU.<br/>
                <a href="${dashboardUrl}" style="color: #8b5cf6 !important;">Управление уведомлениями в личном кабинете</a>
            </div>
        </div>
    </body>
    </html>
  `;

  const textContent = `
    Добро пожаловать в HH4YOU!

    Ваша подписка активна.
    HH4YOU уже начинает поиск вакансий по вашему резюме на HH.ru, Habr Career и SuperJob.

    ВАЖНО: первые письма с вакансиями могут попасть в папку «Спам».
    Пожалуйста, найдите наше письмо и отметьте его как «Не спам».

    Личный кабинет: ${dashboardUrl}
  `;

  return await sendEmail(toEmail, subject, htmlContent, textContent);
}

async function sendPasswordResetEmail(toEmail, resetLink) {
  const subject = `🔑 [HH4YOU] Восстановление пароля`;
  const dashboardUrl = config.baseUrl || 'http://localhost:8000';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333333; background-color: #f4f6fa; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
            .header { border-bottom: 2px solid #8b5cf6; padding-bottom: 15px; margin-bottom: 20px; text-align: center; }
            .logo { font-size: 24px; font-weight: bold; color: #8b5cf6; text-decoration: none; }
            .btn { display: inline-block; background: #8b5cf6; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 10px; }
            .footer { margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px; font-size: 11px; color: #94a3b8; text-align: center; }
            .footer a { color: #8b5cf6; text-decoration: none; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <a href="${dashboardUrl}" class="logo" style="color: #8b5cf6 !important; text-decoration: none;">HH4YOU</a>
            </div>
            <h2>Восстановление пароля</h2>
            <p>Вы получили это письмо, потому что запросили сброс пароля для вашей учетной записи на HH4YOU.</p>
            <p>Ссылка действительна в течение 15 минут. Вы можете перейти по ссылке ниже, чтобы задать новый пароль:</p>
            <p style="text-align: center;">
                <a href="${resetLink}" class="btn" style="color: #ffffff !important;">Восстановить пароль</a>
            </p>
            <p>Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.</p>
            <div class="footer">
                © 2026 HH4YOU. Все права защищены.
            </div>
        </div>
    </body>
    </html>
  `;

  const textContent = `
    Восстановление пароля на HH4YOU

    Вы получили это письмо, потому что запросили сброс пароля для вашей учетной записи на HH4YOU.

    Ссылка действительна в течение 15 минут. Перейдите по ссылке ниже, чтобы задать новый пароль:

    ${resetLink}

    Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.
  `;

  return await sendEmail(toEmail, subject, htmlContent, textContent);
}

module.exports = {
  sendMatchNotification,
  sendBillingWarning,
  sendWelcomeEmail,
  sendPasswordResetEmail
};
