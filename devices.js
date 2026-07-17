export async function getLocalStream(cameraId = null, micId = null) {
  const constraints = {
    video: cameraId
      ? { deviceId: { exact: cameraId } }
      : true,
    audio: micId
      ? { deviceId: { exact: micId } }
      : true
  };

  return navigator.mediaDevices.getUserMedia(constraints);
}

export async function updateDeviceList() {
  const cameraSelect = document.getElementById("cameraSelect");
  const micSelect = document.getElementById("micSelect");

  if (!cameraSelect || !micSelect) return;

  // 権限取得
  let tempStream = null;

  try {
    tempStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
  } catch (e) {
    console.warn("Permission denied", e);
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
