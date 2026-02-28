const button = document.getElementById('demoButton');
const statusText = document.getElementById('statusText');

if (button && statusText) {
  button.addEventListener('click', () => {
    const now = new Date().toLocaleTimeString();
    statusText.textContent = `Demo action ran at ${now}.`;
  });
}
