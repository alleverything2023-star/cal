export async function getLocalStream(cameraId = null, micId = null) {
  const constraints = {
    video: cameraId ? { deviceId: { exact: cameraId } } : true,
    audio: micId ? { deviceId: { exact: micId } } : true
  };
  return await navigator.mediaDevices.getUserMedia(constraints);
}

export async function updateDeviceList() {
  const cameraSelect = document.getElementById("cameraSelect");
  const micSelect = document.getElementById("micSelect");
  if (!cameraSelect || !micSelect) return;

  const devices = await navigator.mediaDevices.enumerateDevices();
  cameraSelect.innerHTML = "";
  micSelect.innerHTML = "";

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
