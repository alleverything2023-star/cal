import {
ref,
set,
onValue,
onDisconnect,
serverTimestamp
}
from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";

import { db } from "./firebase.js";

export let myId = null;

export async function joinRoom(name){

myId = crypto.randomUUID();

await set(
ref(db,"participants/" + myId),
{
name,
joinedAt:Date.now()
}
);

onDisconnect(
ref(db,"participants/" + myId)
).remove();

}

export function listenParticipants(callback){

onValue(
ref(db,"participants"),
snapshot=>{

const data =
snapshot.val() || {};

callback(data);

});

}
