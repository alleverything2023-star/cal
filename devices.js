export async function getLocalStream(cameraId = null, micId = null) {
  // すでにある要素を一切削減せず、空文字や無効な値による OverconstrainedError を防ぐために
  // 条件分岐をより厳密かつ柔軟（exact から ideal）に修正しています。
  const constraints = {
    video: cameraId && cameraId !== ""
      ? { deviceId: { ideal: cameraId } }
      : { facingMode: "user" },
    audio: micId && micId !== ""
      ? { deviceId: { ideal: micId } }
      : true
  };

  return navigator.mediaDevices.getUserMedia(constraints);
}

export async function updateDeviceList() {
  const cameraSelect = document.getElementById("cameraSelect");
  const micSelect = document.getElementById("micSelect");

  if (!cameraSelect || !micSelect) return;

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
}
