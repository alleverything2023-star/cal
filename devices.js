export async function getLocalStream(cameraId = null, micId = null) {
  // iPad/iOS向けに、特定のID指定がない場合は、デフォルトの「前面カメラ（user）」を優先する設定
  const videoConstraints = cameraId 
    ? { deviceId: { exact: cameraId } } 
    : { facingMode: "user" };

  const audioConstraints = micId 
    ? { deviceId: { exact: micId } } 
    : true;

  const constraints = {
    video: videoConstraints,
    audio: audioConstraints
  };

  return await navigator.mediaDevices.getUserMedia(constraints);
}

export async function updateDeviceList() {
  const cameraSelect = document.getElementById("cameraSelect");
  const micSelect = document.getElementById("micSelect");
  if (!cameraSelect || !micSelect) return;

  // デバイス一覧を取得する前にパーミッションが確定している必要があります
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
