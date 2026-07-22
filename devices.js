export async function getLocalStream(cameraId = null, micId = null) {
  // ノイズ抑制(noiseSuppression)と自動音量調整(autoGainControl)はブラウザ既定でON。
  // これがかなり強めにかかるため、声が「篭る」原因になりやすい。
  // ハウリング防止に必要なエコーキャンセル(echoCancellation)だけは有効にしたまま、
  // 音質に影響が大きい2つはOFFにする。
  const audioConstraints = {
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: false
  };
  if (micId) audioConstraints.deviceId = { exact: micId };

  const constraints = {
    video: cameraId
      ? { deviceId: { exact: cameraId } }
      : true,
    audio: audioConstraints
  };

  return navigator.mediaDevices.getUserMedia(constraints);
}

export async function updateDeviceList(requestPermission = true) {
  const cameraSelect = document.getElementById("cameraSelect");
  const micSelect = document.getElementById("micSelect");

  if (!cameraSelect || !micSelect) return;

  // 権限取得
  // requestPermission=false の場合はgetUserMediaを呼ばない。
  // iPad Safari等ではユーザー操作(タップ)を伴わずにgetUserMediaを呼ぶと
  // リクエストが宙に浮き、後続の(ボタン操作による)正規のカメラ要求まで
  // 反応しなくなることがあるため、ページ読み込み時の自動呼び出しでは
  // 権限要求そのものをスキップし、一覧取得のみ行う。
  let tempStream = null;

  if (requestPermission) {
    try {
      tempStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
    } catch (e) {
      console.warn("Permission denied", e);
    }
  }

  const devices = await navigator.mediaDevices.enumerateDevices();

  cameraSelect.innerHTML = "";
  micSelect.innerHTML = "";

  let cam = 1;
  let mic = 1;

  devices.forEach(device => {
    const option = document.createElement("option");
    option.value = device.deviceId;

    if (device.kind === "videoinput") {
      option.textContent = device.label || `カメラ ${cam++}`;
      cameraSelect.appendChild(option);
    }

    if (device.kind === "audioinput") {
      option.textContent = device.label || `マイク ${mic++}`;
      micSelect.appendChild(option);
    }
  });

  if (tempStream) {
    tempStream.getTracks().forEach(track => track.stop());
  }
}
