const nodemailer = require('nodemailer');

// Gmail configuration for sending emails
const createEmailTransporter = () => {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      host: 'smtp.gmail.com', 
      port: 465,
      secure: true, // Use SSL/TLS for port 465
      auth: {
        user: process.env.EMAIL_USER || 'managementtime04@gmail.com',
        pass: process.env.EMAIL_APP_PASSWORD || 'sarxoodfrrxbbfuk' // Gmail app password
      },
      pool: true, // Use connection pooling
      maxConnections: 5,
      rateLimit: 10 // Send max 10 emails per second
    });
    
    // Verify transporter configuration
    console.log('📧 Email transporter created successfully');
    return transporter;
  } catch (error) {
    console.error('❌ Email transporter creation failed:', error);
    throw error;
  }
};

// Send OTP email in German
const sendOTPEmailGerman = async (email, otp) => {
  try {
    const transporter = createEmailTransporter();
    
    const mailOptions = {
      from: {
        name: 'Time Management System',
        address: 'managementtime04@gmail.com'
      },
      to: email,
      subject: 'Aktion erforderlich: Passwort zurücksetzen',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Aktion erforderlich: Passwort zurücksetzen</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');
            body { margin: 0; padding: 0; font-family: 'Inter', Arial, sans-serif; background-color: #f5f7fa; }
            .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; }
            .header h1 { color: white; margin: 0; font-size: 24px; font-weight: 600; }
            .content { padding: 40px 30px; }
            .greeting { font-size: 18px; color: #2d3748; margin-bottom: 25px; font-weight: 500; }
            .message { color: #4a5568; line-height: 1.6; margin-bottom: 30px; }
            .code-container { background: #f7fafc; border: 2px solid #e2e8f0; border-radius: 12px; padding: 30px; text-align: center; margin: 30px 0; }
            .code-label { color: #2d3748; font-weight: 600; margin-bottom: 15px; font-size: 16px; }
            .code { font-size: 36px; font-weight: 700; color: #3182ce; letter-spacing: 8px; font-family: 'Courier New', monospace; }
            .expiry { background: #fff5f5; border-left: 4px solid #f56565; padding: 15px; margin: 25px 0; color: #c53030; font-size: 14px; border-radius: 4px; }
            .security-tips { background: #f0fff4; border: 1px solid #9ae6b4; border-radius: 8px; padding: 20px; margin: 25px 0; }
            .security-tips h3 { color: #276749; margin: 0 0 15px 0; font-size: 16px; }
            .security-tips ul { margin: 0; padding-left: 20px; color: #2f855a; }
            .security-tips li { margin-bottom: 8px; }
            .footer { background: #2d3748; color: #a0aec0; padding: 30px; text-align: center; font-size: 14px; }
            .footer-link { color: #63b3ed; text-decoration: none; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 Aktion erforderlich: Passwort zurücksetzen</h1>
            </div>
            
            <div class="content">
              <div class="greeting">Hallo,</div>
              
              <div class="message">
                wir haben eine Anfrage zum Zurücksetzen des Passworts für Ihr Konto erhalten. Um fortzufahren, verwenden Sie bitte den folgenden Bestätigungscode.
              </div>
              
              <div class="code-container">
                <div class="code-label">Ihr Bestätigungscode:</div>
                <div class="code">${otp}</div>
              </div>
              
              <div class="expiry">
                <strong>⏰ Der Code ist aus Sicherheitsgründen 5 Minuten gültig.</strong>
              </div>
              
              <div class="message">
                Geben Sie diesen 4-stelligen Code auf der Seite zum Zurücksetzen des Passworts ein. Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren. Ihr Konto bleibt sicher.
              </div>
              
              <div class="security-tips">
                <h3>🛡️ Zu Ihrer Sicherheit:</h3>
                <ul>
                  <li>Teilen Sie diesen Code mit niemandem</li>
                  <li>Unser Support-Team wird Sie niemals nach diesem Code fragen</li>
                  <li>Wenn Sie weiterhin Probleme haben oder glauben, dass diese Anfrage irrtümlich erfolgt ist, wenden Sie sich bitte an unser Support-Team</li>
                </ul>
              </div>
            </div>
            
            <div class="footer">
              <p><strong>Vielen Dank,</strong><br>Ihr Support-Team</p>
              <p>© 2025 Time Management System. Alle Rechte vorbehalten.</p>
              <p>Wenn Sie Hilfe benötigen, kontaktieren Sie uns unter <a href="mailto:support@timemanagement.com" class="footer-link">support@timemanagement.com</a></p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
Aktion erforderlich: Passwort zurücksetzen

Hallo,

wir haben eine Anfrage zum Zurücksetzen des Passworts für Ihr Konto erhalten. Um fortzufahren, verwenden Sie bitte den folgenden Bestätigungscode.

Ihr Bestätigungscode: ${otp}

Geben Sie diesen 4-stelligen Code auf der Seite zum Zurücksetzen des Passworts ein. Der Code ist aus Sicherheitsgründen 5 Minuten gültig.

Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren. Ihr Konto bleibt sicher.

Zu Ihrer Sicherheit:
• Teilen Sie diesen Code mit niemandem
• Unser Support-Team wird Sie niemals nach diesem Code fragen
• Wenn Sie weiterhin Probleme haben oder glauben, dass diese Anfrage irrtümlich erfolgt ist, wenden Sie sich bitte an unser Support-Team

Vielen Dank,
Ihr Support-Team
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log(`✅ German OTP email sent to ${email}:`, result.messageId);
    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    console.error(`❌ Failed to send German OTP email to ${email}:`, error);
    return { success: false, error: error.message };
  }
};

// Send OTP email
const sendOTPEmail = async (email, otp) => {
  try {
    const transporter = createEmailTransporter();
    
    const mailOptions = {
      from: {
        name: 'Time Management System',
        address: 'managementtime04@gmail.com'
      },
      to: email,
      subject: 'Action Required: Password Reset Verification',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Action Required: Password Reset Verification</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');
            body { margin: 0; padding: 0; font-family: 'Inter', Arial, sans-serif; background-color: #f5f7fa; }
            .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; }
            .header h1 { color: white; margin: 0; font-size: 24px; font-weight: 600; }
            .content { padding: 40px 30px; }
            .greeting { font-size: 18px; color: #2d3748; margin-bottom: 25px; font-weight: 500; }
            .message { color: #4a5568; line-height: 1.6; margin-bottom: 30px; }
            .code-container { background: #f7fafc; border: 2px solid #e2e8f0; border-radius: 12px; padding: 30px; text-align: center; margin: 30px 0; }
            .code-label { color: #2d3748; font-weight: 600; margin-bottom: 15px; font-size: 16px; }
            .code { font-size: 36px; font-weight: 700; color: #3182ce; letter-spacing: 8px; font-family: 'Courier New', monospace; }
            .expiry { background: #fff5f5; border-left: 4px solid #f56565; padding: 15px; margin: 25px 0; color: #c53030; font-size: 14px; border-radius: 4px; }
            .security-tips { background: #f0fff4; border: 1px solid #9ae6b4; border-radius: 8px; padding: 20px; margin: 25px 0; }
            .security-tips h3 { color: #276749; margin: 0 0 15px 0; font-size: 16px; }
            .security-tips ul { margin: 0; padding-left: 20px; color: #2f855a; }
            .security-tips li { margin-bottom: 8px; }
            .footer { background: #2d3748; color: #a0aec0; padding: 30px; text-align: center; font-size: 14px; }
            .footer-link { color: #63b3ed; text-decoration: none; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 Action Required: Password Reset Verification</h1>
            </div>
            
            <div class="content">
              <div class="greeting">Hello,</div>
              
              <div class="message">
                We received a request to reset the password for your account. To continue, please use the verification code below.
              </div>
              
              <div class="code-container">
                <div class="code-label">Your verification code:</div>
                <div class="code">${otp}</div>
              </div>
              
              <div class="expiry">
                <strong>⏰ This code will expire in 5 minutes</strong> for security reasons.
              </div>
              
              <div class="message">
                Enter this 4-digit code on the password reset screen to proceed. If you did not request a password reset, please ignore this email. Your account will remain secure.
              </div>
              
              <div class="security-tips">
                <h3>🛡️ For your protection:</h3>
                <ul>
                  <li>Do not share this code with anyone</li>
                  <li>Our support team will never ask for your verification code</li>
                  <li>If you continue to experience issues or believe this request was made in error, please contact our support team</li>
                </ul>
              </div>
            </div>
            
            <div class="footer">
              <p><strong>Thank you,</strong><br>The Support Team</p>
              <p>© 2025 Time Management System. All rights reserved.</p>
              <p>If you need help, contact us at <a href="mailto:support@timemanagement.com" class="footer-link">support@timemanagement.com</a></p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
Action Required: Password Reset Verification

Hello,

We received a request to reset the password for your account. To continue, please use the verification code below.

Your verification code: ${otp}

Enter this 4-digit code on the password reset screen to proceed. This code will expire in 5 minutes for security reasons.

If you did not request a password reset, please ignore this email. Your account will remain secure.

For your protection:
• Do not share this code with anyone
• Our support team will never ask for your verification code
• If you continue to experience issues or believe this request was made in error, please contact our support team

Thank you,
The Support Team
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log(`✅ OTP email sent to ${email}:`, result.messageId);
    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    console.error('❌ Email sending failed:', error);
    return { success: false, error: error.message };
  }
};

// Send password reset confirmation email
const sendPasswordResetConfirmation = async (email) => {
  try {
    const transporter = createEmailTransporter();
    
    const mailOptions = {
      from: {
        name: 'Time Management System',
        address: 'managementtime04@gmail.com'
      },
      to: email,
      subject: '✅ Password Reset Successful - Time Management System',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset Successful</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="margin: 0; font-size: 28px;">✅ Password Reset Successful</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">Time Management System</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e9ecef;">
            <p style="font-size: 16px; margin-bottom: 20px;">Hello,</p>
            
            <p style="font-size: 16px; margin-bottom: 20px;">
              Your password has been successfully reset for Time Management System.
            </p>
            
            <div style="background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; border-radius: 5px; margin: 20px 0; text-align: center;">
              <p style="margin: 0; font-size: 16px;">
                <strong>🎉 You can now login with your new password!</strong>
              </p>
            </div>
            
            <p style="font-size: 16px; margin-bottom: 15px;">
              <strong>What's Next:</strong>
            </p>
            <ul style="font-size: 14px; line-height: 1.8;">
              <li>Login to your account using your new password</li>
              <li>Make sure to keep your password secure</li>
              <li>Consider using a password manager</li>
            </ul>
            
            <div style="background: #fff3cd; border: 1px solid #ffeeba; color: #856404; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p style="margin: 0; font-size: 14px;">
                <strong>🛡️ Security Tip:</strong> If you didn't make this change, please contact support immediately.
              </p>
            </div>
            
            <hr style="border: none; border-top: 1px solid #e9ecef; margin: 30px 0;">
            
            <p style="font-size: 12px; color: #6c757d; text-align: center; margin: 0;">
              This is an automated email from Time Management System.<br>
              Please do not reply to this email.
            </p>
          </div>
        </body>
        </html>
      `,
      text: `
Password Reset Successful - Time Management System

Hello,

Your password has been successfully reset for Time Management System.

You can now login with your new password!

What's Next:
- Login to your account using your new password
- Make sure to keep your password secure  
- Consider using a password manager

If you didn't make this change, please contact support immediately.

Time Management System
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log(`✅ Password reset confirmation sent to ${email}:`, result.messageId);
    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    console.error('❌ Confirmation email sending failed:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendOTPEmail,
  sendOTPEmailGerman,
  sendPasswordResetConfirmation
};