const title = document.getElementById('title');
  let animation;

  window.showReminder = text => {
    animation?.cancel();
    title.textContent = text;
    animation = title.animate([
      {opacity: 0, offset: 0, easing: 'ease-out'},
      {opacity: 0.78, offset: 0.25},
      {opacity: 0.78, offset: 0.75, easing: 'ease-in'},
      {opacity: 0, offset: 1}
    ], {duration: 2000});
    animation.onfinish = () => window.__TAURI__.core.invoke('hide_task_reminder');
  };
