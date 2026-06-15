// カメラ・マイクのストリームを取得する関数
export async function getLocalStream(cameraId = null, micId = null) {
  const constraints = {
    audio: micId ? { deviceId: { exact: micId } } : true,
    video: true
  };

  if (cameraId) {
    const videoDevices = await navigator.mediaDevices.enumerateDevices();
    const selectedDevice = videoDevices.find(device => device.deviceId === cameraId);
    
    const isBackCamera = selectedDevice && (
      /back/i.test(selectedDevice.label) || 
      /背面/i.test(selectedDevice.label) || 
      /外/i.test(selectedDevice.label) || 
      /environment/i.test(selectedDevice.label)
    );

    if (isBackCamera) {
      constraints.video = {
        deviceId: { exact: cameraId },
        facingMode: "environment"
      };
    } else {
      constraints.video = {
        deviceId: { exact: cameraId },
        facingMode: "user"
      };
    }
  } else {
    constraints.video = { facingMode: "user" };
  }

  return await navigator.mediaDevices.getUserMedia(constraints);
}

// 利用可能なデバイス一覧をセレクトボックスに反映する関数
export async function updateDeviceList() {
  const cameraSelect = document.getElementById("cameraSelect");
  const micSelect = document.getElementById("micSelect");

  if (!cameraSelect || !micSelect) return;

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
