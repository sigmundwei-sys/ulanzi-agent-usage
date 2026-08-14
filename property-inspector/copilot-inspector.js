(function () {
  const input = document.getElementById('profile-id');

  function save() {
    $UD.setSettings({ profileId: input.value.trim() });
  }

  function load(settings) {
    input.value = settings?.profileId || settings?.accountLogin || '';
  }

  input.addEventListener('change', save);

  $UD.onConnected(() => $UD.getSettings());
  $UD.onParamFromApp((msg) => load(msg.param));
  $UD.onDidReceiveSettings((msg) => load(msg.settings));
  // UlanziStudio supplies the action UUID/context in the inspector URL.
  $UD.connect(Utils.getQueryParams('uuid') || 'com.ulanzi.ulanzistudio.agentusage.copilot_chat');
})();
