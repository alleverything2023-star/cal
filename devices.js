/**
 * カメラとマイクの許可を取り、ストリームを取得する
 * @param {string|null} videoDeviceId 
 * @param {string|null} audioDeviceId 
 */
export async function getLocalStream(videoDeviceId = null, audioDeviceId = null) {
  const constraints = {
    video: videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true,
    audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true
  };
  return await navigator.mediaDevices.getUserMedia(constraints);
}

/**
 * 接続されているカメラ・マイクの一覧をセレクトボックスに反映する
 * ※ブラウザの仕様上、一度getUserMediaに成功した後に呼ぶ必要があります
 */
export async function updateDeviceList() {
  const cameraSelect = document.getElementById("cameraSelect");
  const micSelect = document.getElementById("micSelect");

  const currentCamera = cameraSelect.value;
  const currentMic = micSelect.value;

  cameraSelect.innerHTML = "";
  micSelect.innerHTML = "";

  const devices = await navigator.mediaDevices.enumerateDevices();

  devices.forEach(device => {
    const option = document.createElement("option");
    option.value = device.deviceId;

    if (device.kind === "videoinput") {
      option.text = device.label || `カメラ (${cameraSelect.length + 1})`;
      if (device.deviceId === currentCamera) option.selected = true;
      cameraSelect.appendChild(option);
    } else if (device.kind === "audioinput") {
      option.text = device.label || `マイク (${micSelect.length + 1})`;
      if (device.deviceId === currentMic) option.selected = true;
      micSelect.appendChild(option);
    }
  });
}
