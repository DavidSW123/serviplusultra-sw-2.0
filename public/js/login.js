document.getElementById('formLogin').addEventListener('submit', function(e) {
    e.preventDefault();
    const user = document.getElementById('user').value;
    const pass = document.getElementById('pass').value;

    fetch('/api/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: user, password: pass })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            const errorBox = document.getElementById('errorBox');
            errorBox.style.display = 'block';
            errorBox.innerText = data.error;
        } else {
            localStorage.setItem('sesionPlusUltra', JSON.stringify({ username: data.username, rol: data.rol }));
            window.location.href = '/';
        }
    })
    .catch(() => alert('Error de conexión con el servidor.'));
});
