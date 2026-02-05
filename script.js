// Password configuration
const CORRECT_PASSWORD = 'baruther';

// Get elements
const passwordScreen = document.getElementById('password-screen');
const passwordInput = document.getElementById('password-input');
const errorMessage = document.getElementById('error-message');
const mainContent = document.getElementById('main-content');

// Check if user has already entered correct password (stored in session)
if (sessionStorage.getItem('authenticated') === 'true') {
    showMainContent();
}

// Listen for password input
passwordInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        checkPassword();
    }
});

// Hide error message when user starts typing again
passwordInput.addEventListener('input', function() {
    errorMessage.classList.add('error-hidden');
});

function checkPassword() {
    const enteredPassword = passwordInput.value;
    
    if (enteredPassword === CORRECT_PASSWORD) {
        // Store authentication in session
        sessionStorage.setItem('authenticated', 'true');
        showMainContent();
    } else {
        // Show error message
        errorMessage.classList.remove('error-hidden');
        passwordInput.value = '';
        
        // Shake animation for input
        passwordInput.style.animation = 'shake 0.3s';
        setTimeout(() => {
            passwordInput.style.animation = '';
        }, 300);
    }
}

function showMainContent() {
    // Fade out password screen
    passwordScreen.classList.add('fade-out');
    
    // After fade out, show main content
    setTimeout(() => {
        passwordScreen.style.display = 'none';
        mainContent.classList.remove('content-hidden');
        mainContent.classList.add('content-visible');
    }, 600);
}

// Optional: Add shake animation to CSS (inline for simplicity)
const style = document.createElement('style');
style.textContent = `
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-10px); }
        75% { transform: translateX(10px); }
    }
`;
document.head.appendChild(style);

// Focus on password input on page load
window.addEventListener('load', function() {
    if (!sessionStorage.getItem('authenticated')) {
        passwordInput.focus();
    }
});
