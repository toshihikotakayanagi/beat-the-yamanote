// キー入力の状態を保持する。矢印キーと WASD の両方に対応。

const KEY_MAP = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

export function createInput(target = window) {
  const state = { up: false, down: false, left: false, right: false };

  const set = (e, pressed) => {
    const action = KEY_MAP[e.code];
    if (!action) return;
    state[action] = pressed;
    e.preventDefault(); // 矢印キーでページがスクロールしないように
  };

  target.addEventListener('keydown', (e) => set(e, true));
  target.addEventListener('keyup', (e) => set(e, false));
  // ウィンドウからフォーカスが外れたら押しっぱなしを解除
  target.addEventListener('blur', () => {
    for (const k of Object.keys(state)) state[k] = false;
  });

  return state;
}

// 画面上のボタン（data-key="up" など）を押している間、その操作を入れる。
// ボタンごとに指を追うので、ハンドルとアクセルの同時押しができる。
export function bindTouchButtons(state, container) {
  for (const btn of container.querySelectorAll('[data-key]')) {
    const action = btn.dataset.key;
    const press = (e) => {
      e.preventDefault();
      state[action] = true;
      btn.classList.add('active');
      // 指がボタンの外にずれても押したままにする（失敗しても入力は有効のまま）
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // 取れなくても pointerup で離したことは分かる
      }
    };
    const release = () => {
      state[action] = false;
      btn.classList.remove('active');
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault()); // 長押しメニューを出さない
  }
}
