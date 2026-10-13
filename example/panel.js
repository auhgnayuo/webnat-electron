'use strict';

const api = window.nativeExample;
const logs = document.getElementById('logs');
const connection = document.getElementById('connection');
const url = document.getElementById('url');

function renderEmpty() {
  if (!logs.children.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '尚无通信记录';
    logs.appendChild(empty);
  }
}

function addLog(entry) {
  const empty = logs.querySelector('.empty');
  if (empty) empty.remove();

  const item = document.createElement('article');
  item.className = `entry ${entry.type}`;

  const head = document.createElement('div');
  head.className = 'entry-head';
  const label = document.createElement('span');
  label.textContent = entry.type === 'sent' ? '发送' : entry.type === 'error' ? '错误' : '接收';
  const time = document.createElement('time');
  time.textContent = entry.time;
  head.append(label, time);

  const message = document.createElement('p');
  message.textContent = entry.message;
  item.append(head, message);

  if (entry.data !== null && entry.data !== undefined) {
    const data = document.createElement('pre');
    data.textContent = JSON.stringify(entry.data, null, 2);
    item.appendChild(data);
  }

  logs.appendChild(item);
  logs.scrollTop = logs.scrollHeight;
}

api.onLog(addLog);
api.onState((state) => {
  connection.textContent = state.connected ? `已连接 · ${state.connections}` : '等待连接';
  connection.classList.toggle('connected', state.connected);
  url.textContent = state.webUrl;
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.disabled = !state.connected;
  });
});
api.onClearLogs(() => {
  logs.replaceChildren();
  renderEmpty();
});

for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await api[button.dataset.action]();
    } catch (error) {
      addLog({ time: new Date().toLocaleTimeString(), type: 'error', message: error.message || String(error), data: null });
    } finally {
      button.disabled = false;
    }
  });
}

document.getElementById('clear').addEventListener('click', () => api.clearLogs());
renderEmpty();
