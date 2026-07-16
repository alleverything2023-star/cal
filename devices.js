export async function getLocalStream(cameraId = null, micId = null) {
  const videoConstraints = cameraId
    ? { deviceId: { exact: cameraId } }
    : { facingMode: "user" };

  const audioConstraints = micId
    ? { deviceId: { exact: micId } }
    : true;

  return await navigator.mediaDevices.getUserMedia({
    video: videoConstraints,
    audio: audioConstraints
  });
}

export async function updateDeviceList() {
  const cameraSelect = document.getElementById("cameraSelect");
  const micSelect = document.getElementById("micSelect");

  if (!cameraSelect || !micSelect) return;

  // Safariでは最初に権限取得しないとenumerateDevicesが空になることがある
  try {
    const permissionStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    permissionStream.getTracks().forEach(track => track.stop());
  } catch (err) {
    console.error("メディア権限取得失敗:", err);
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();

  cameraSelect.innerHTML = "";
  micSelect.innerHTML = "";

  let cameraCount = 0;
  let micCount = 0;

  devices.forEach(device => {
    if (device.kind === "videoinput") {
      cameraCount++;

      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent =
        device.label || `カメラ ${cameraCount}`;

      cameraSelect.appendChild(option);
    }

    if (device.kind === "audioinput") {
      micCount++;

      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent =
        device.label || `マイク ${micCount}`;

      micSelect.appendChild(option);
    }
  });

  // iPadなどで接続中にデバイス変更された場合も更新
  if (!navigator.mediaDevices.__deviceChangeRegistered) {
    navigator.mediaDevices.addEventListener("devicechange", async () => {
      try {
        await updateDeviceList();
      } catch (e) {
        console.warn(e);
      }
    });

    navigator.mediaDevices.__deviceChangeRegistered = true;
  }

  console.log("取得デバイス一覧", devices);
}
