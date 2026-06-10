// Password configuration — SHA-256 hash of the password (plaintext is not stored).
// To change it, run in the browser console:
//   crypto.subtle.digest('SHA-256', new TextEncoder().encode('newpassword')).then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('')))
const PASSWORD_HASH = 'bd5e82f530135131fa5a564b40d24ae41ac77402570930c7bc2d863d17fac8a8';

async function hashText(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Get elements
const passwordScreen = document.getElementById('password-screen');
const passwordInput = document.getElementById('password-input');
const errorMessage = document.getElementById('error-message');
const mainContent = document.getElementById('main-content');

// Check if user has already entered correct password
if (sessionStorage.getItem('authenticated') === 'true') {
    showMainContent();
}

// Password input listeners
passwordInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        checkPassword();
    }
});

passwordInput.addEventListener('input', function() {
    errorMessage.classList.add('error-hidden');
});

async function checkPassword() {
    const enteredPassword = passwordInput.value;

    if (await hashText(enteredPassword) === PASSWORD_HASH) {
        sessionStorage.setItem('authenticated', 'true');
        showMainContent();
    } else {
        errorMessage.classList.remove('error-hidden');
        passwordInput.value = '';
        passwordInput.style.animation = 'shake 0.3s';
        setTimeout(() => {
            passwordInput.style.animation = '';
        }, 300);
    }
}

function showMainContent() {
    passwordScreen.classList.add('fade-out');
    setTimeout(() => {
        passwordScreen.style.display = 'none';
        mainContent.classList.remove('content-hidden');
        mainContent.classList.add('content-visible');
        initNavigation();
    }, 600);
}

// Navigation functionality
function initNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('.section');
    
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            const sectionId = this.getAttribute('data-section');
            
            // Remove active class from all links and sections
            navLinks.forEach(l => l.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            
            // Add active class to clicked link and corresponding section
            this.classList.add('active');
            document.getElementById(sectionId + '-section').classList.add('active');
        });
    });
}

// Shake animation
const style = document.createElement('style');
style.textContent = `
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-10px); }
        75% { transform: translateX(10px); }
    }
`;
document.head.appendChild(style);

// Focus on password input on load
window.addEventListener('load', function() {
    if (!sessionStorage.getItem('authenticated')) {
        passwordInput.focus();
    }
});
