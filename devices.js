// カメラ・マイクのストリームを取得する関数
export async function getLocalStream(cameraId = null, micId = null) {
  const constraints = {
    audio: micId ? { deviceId: { exact: micId } } : true,
    video: true // デフォルト
  };

  if (cameraId) {
    // 選択されたカメラのラベル（名前）に「back」「背面」「environment」「外」が含まれているか判定
    const videoDevices = await navigator.mediaDevices.enumerateDevices();
    const selectedDevice = videoDevices.find(device => device.deviceId === cameraId);
    
    const isBackCamera = selectedDevice && (
      /back/i.test(selectedDevice.label) || 
      /背面/i.test(selectedDevice.label) || 
      /外/i.test(selectedDevice.label) || 
      /environment/i.test(selectedDevice.label)
    );

    if (isBackCamera) {
      // 背面カメラの場合は facingMode を指定（iPad/iPhoneで極めて重要）
      constraints.video = {
        deviceId: { exact: cameraId },
        facingMode: "environment"
      };
    } else {
      // 前面カメラなどの場合
      constraints.video = {
        deviceId: { exact: cameraId },
        facingMode: "user"
      };
    }
  } else {
    // 初回起動時などは前面カメラをデフォルトにする
    constraints.video = { facingMode: "user" };
  }

  return await navigator.mediaDevices.getUserMedia(constraints);
}

// 利用可能なデバイス一覧をセレクトボックスに反映する関数
export async function updateDeviceList() {
  const cameraSelect = document.getElementById("cameraSelect");
  const micSelect = document.getElementById("micSelect");

  if (!cameraSelect || !micSelect) return;

  // 既存の選択肢をクリア
  cameraSelect.innerHTML = "";
  micSelect.innerHTML = "";

  const devices = await navigator.mediaDevices.enumerateDevices();

  devices.forEach(device => {
    const option = document.createElement("option");
    option.value = device.deviceId;

    if (device.kind === "videoinput") {
      option.text = device.label || `カメラ ${cameraSelect.length + 1}`;
      cameraSelect.appendChild(option);
    } else if (device.kind === "audioinput") {
      option.text = device.label || `マイク ${micSelect.length + 1}`;
      micSelect.appendChild(option);
    }
  });
}
