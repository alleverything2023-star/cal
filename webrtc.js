import { ref, set, push, child, onValue, onChildAdded, off } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";
import { db } from "./firebase.js";
import { myId } from "./room.js";

const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

export const peerConnections = {};
const signalListeners = {};

export function startP2P(peerId, localStream, onRemoteStream) {
  if (peerConnections[peerId]) return;

  const pc = new RTCPeerConnection(configuration);
  peerConnections[peerId] = pc;
  signalListeners[peerId] = [];

  let remoteDescSet = false;
  const iceQueue = [];

  const processIceQueue = () => {
    remoteDescSet = true;
    while (iceQueue.length > 0) {
      const candidate = iceQueue.shift();
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
    }
  };

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      onRemoteStream(peerId, event.streams[0]);
    }
  };

  // IDの文字列表記の大小でオファー側/アンサー側を一意に決定
  const isInitiator = myId < peerId;
  const roomKey = isInitiator ? `${myId}_${peerId}` : `${peerId}_${myId}`;
  const signalPath = ref(db, `signals/${roomKey}`);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      const candidateType = isInitiator ? "candidatesA" : "candidatesB";
      push(child(signalPath, candidateType), event.candidate.toJSON());
    }
  };

  if (isInitiator) {
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => set(child(signalPath, "offer"), pc.localDescription.toJSON()))
      .catch(e => console.error(e));

    const answerRef = child(signalPath, "answer");
    onValue(answerRef, (snapshot) => {
      const answer = snapshot.val();
      if (answer && pc.signalingState === "have-local-offer") {
        pc.setRemoteDescription(new RTCSessionDescription(answer))
          .then(() => processIceQueue())
          .catch(e => console.error(e));
      }
    });
    signalListeners[peerId].push(answerRef);

    const candBRef = child(signalPath, "candidatesB");
    onChildAdded(candBRef, (snapshot) => {
      const candidate = snapshot.val();
      if (candidate) {
        if (remoteDescSet) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
        else iceQueue.push(candidate);
      }
    });
    signalListeners[peerId].push(candBRef);

  } else {
    const offerRef = child(signalPath, "offer");
    onValue(offerRef, (snapshot) => {
      const offer = snapshot.val();
      if (offer && pc.signalingState === "stable") {
        pc.setRemoteDescription(new RTCSessionDescription(offer))
          .then(() => {
            processIceQueue();
            return pc.createAnswer();
          })
          .then(answer => pc.setLocalDescription(answer))
          .then(() => set(child(signalPath, "answer"), pc.localDescription.toJSON()))
          .catch(e => console.error(e));
      }
    });
    signalListeners[peerId].push(offerRef);

    const candARef = child(signalPath, "candidatesA");
    onChildAdded(candARef, (snapshot) => {
      const candidate = snapshot.val();
      if (candidate) {
        if (remoteDescSet) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
        else iceQueue.push(candidate);
      }
    });
    signalListeners[peerId].push(candARef);
  }
}

export function closeP2P(peerId) {
  if (signalListeners[peerId]) {
    signalListeners[peerId].forEach(reference => off(reference));
    delete signalListeners[peerId];
  }
  if (peerConnections[peerId]) {
    peerConnections[peerId].close();
    delete peerConnections[peerId];
  }
}
