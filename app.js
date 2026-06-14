import { getDevices }
from "./devices.js";

import {
joinRoom,
listenParticipants
}
from "./room.js";

const cameraSelect =
document.getElementById(
"cameraSelect"
);

const micSelect =
document.getElementById(
"micSelect"
);

const joinButton =
document.getElementById(
"joinButton"
);

const participantList =
document.getElementById(
"participantList"
);

const status =
document.getElementById(
"status"
);

async function init(){

try{

const devices =
await getDevices();

devices.cameras
.forEach(camera=>{

const option =
document.createElement(
"option"
);

option.value =
camera.deviceId;

option.textContent =
camera.label;

cameraSelect
.appendChild(option);

});

devices.microphones
.forEach(mic=>{

const option =
document.createElement(
"option"
);

option.value =
mic.deviceId;

option.textContent =
mic.label;

micSelect
.appendChild(option);

});

status.textContent =
"準備完了";

}
catch(err){

status.textContent =
err.message;

}

}

init();

joinButton
.addEventListener(
"click",
async()=>{

const name =
document
.getElementById(
"nameInput"
)
.value
.trim();

if(!name){

alert(
"名前を入力してください"
);

return;

}

await joinRoom(name);

document
.getElementById(
"myName"
)
.textContent = name;

document
.getElementById(
"joinScreen"
)
.style.display =
"none";

document
.getElementById(
"roomScreen"
)
.style.display =
"block";

});

listenParticipants(
participants=>{

participantList
.innerHTML = "";

Object.values(
participants
)
.forEach(user=>{

const li =
document.createElement(
"li"
);

li.textContent =
user.name;

participantList
.appendChild(li);

});

});
