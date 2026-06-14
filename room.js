import {
ref,
set,
onValue,
onDisconnect
}
from
"https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";

import { db }
from "./firebase.js";

export let myId = null;

export async function joinRoom(name){

myId =
crypto.randomUUID();

await set(
ref(db,
"participants/" + myId),
{
name
}
);

onDisconnect(
ref(db,
"participants/" + myId)
).remove();

}

export function listenParticipants(callback){

onValue(
ref(db,"participants"),
snapshot=>{

callback(
snapshot.val() || {}
);

});

}
