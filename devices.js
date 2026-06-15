/**
 * カメラとマイクの許可を取り、ストリームを取得する
 */
export async function getLocalStream(videoDeviceId = null, audioDeviceId = null) {
  // iPadで内向きカメラ（インカメラ）をデフォルトで優先させるための設定
  const defaultVideoConstraint = videoDeviceId 
    ? { deviceId: { exact: videoDeviceId } } 
    : { facingMode: "user" }; // iPadのフロントカメラを狙い撃ち

  const constraints = {
    video: defaultVideoConstraint,
    audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true
  };
  return await navigator.mediaDevices.getUserMedia(constraints);
}

/**
 * 接続されているカメラ・マイクの一覧をセレクトボックスに反映する
 */
export async function updateDeviceList() {
  const cameraSelect = document.getElementById("cameraSelect");
  const micSelect = document.getElementById("micSelect");

  const currentCamera = cameraSelect.value;
  const currentMic = micSelect.value;

  // 1. デバイス一覧を取得
  const devices = await navigator.mediaDevices.enumerateDevices();

  // 2. 取得したデバイスの中に「ラベル（名前）」がちゃんと存在するかチェック
  // ラベルが空の場合、iPadのセキュリティで隠されている証拠
  const hasLabels = devices.some(device => device.label);
  
  if (!hasLabels) {
    console.log("iPadの仕様によりデバイス名がまだ隠されています。");
  }

  // セレクトボックスの中身をクリア
  cameraSelect.innerHTML = "";
  micSelect.innerHTML = "";

  let cameraCount = 0;
  let micCount = 0;

  devices.forEach(device => {
    const option = document.createElement("option");
    option.value = device.deviceId;

    if (device.kind === "videoinput") {
      cameraCount++;
      // ラベルが空なら「カメラ 1」などの代替テキストを入れる（オプションが空になるのを防ぐ）
      option.text = device.label || `カメラ ${cameraCount}`;
      if (device.deviceId === currentCamera) option.selected = true;
      cameraSelect.appendChild(option);
    } else if (device.kind === "audioinput") {
      micCount++;
      option.text = device.label || `マイク ${micCount}`;
      if (device.deviceId === currentMic) option.selected = true;
      micSelect.appendChild(option);
    }
  });
}
