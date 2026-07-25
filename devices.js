function buildAudioConstraints(micId, echoCancellation) {
  // ノイズ抑制(noiseSuppression)と自動音量調整(autoGainControl)はブラウザ既定でON。
  // これがかなり強めにかかるため、声が「篭る」原因になりやすいので常にOFFにする。
  // エコーキャンセル(echoCancellation)は、スピーカー使用時のハウリング防止に必要な一方、
  // iPad Safari等ではONにするとマイク使用中は端末上の他の音声(YouTube等)まで
  // まとめて抑え込まれてしまう。イヤホン・ヘッドホン使用中はハウリングの心配がないため
  // OFFにできるよう、呼び出し側で切り替えられるようにする。
  const audioConstraints = {
    echoCancellation: echoCancellation !== false,
    noiseSuppression: false,
    autoGainControl: false
  };
  if (micId) audioConstraints.deviceId = { exact: micId };
  return audioConstraints;
}

export async function getLocalStream(cameraId = null, micId = null, echoCancellation = true) {
  const constraints = {
    video: cameraId
      ? { deviceId: { exact: cameraId } }
      : true,
    audio: buildAudioConstraints(micId, echoCancellation)
  };

  return navigator.mediaDevices.getUserMedia(constraints);
}

// マイク音声だけを取り直すための関数（通話中にイヤホン設定を切り替えた時に使用）
export async function getAudioOnlyStream(micId = null, echoCancellation = true) {
  return navigator.mediaDevices.getUserMedia({
    audio: buildAudioConstraints(micId, echoCancellation)
  });
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
