import { myId, sendSignalingMessage, listenSignalingMessage } from "./room.js";

// 指定したPeerConnectionの「音声用」のRTCRtpSenderを返す。
// マイクをハードウェアごと解放している間はsender.trackがnullになるため、
// senderのtrackだけでは音声用かどうか判別できない。
// transceiver.receiver.track.kindは(相手が送っている限り)ずっと"audio"のままなので、
// そちらを手がかりに音声用トランシーバーを特定する。
export function getAudioSender(pc) {
  const transceiver = pc.getTransceivers().find(t =>
    (t.sender && t.sender.track && t.sender.track.kind === "audio") ||
    (t.receiver && t.receiver.track && t.receiver.track.kind === "audio")
  );
  return transceiver ? transceiver.sender : null;
}

export const peerConnections = {};
let localStreamRef = null;
let onRemoteStreamRef = null;

// ピアごとの Perfect Negotiation 状態管理用オブジェクト
const connectionStates = {};

// 通話音声(Opus)は既定だと低めのビットレートに抑えられ、声がこもって聞こえやすい。
// SDP内のOpus用fmtp行にmaxaveragebitrateを追加し、音質を上げる。
function increaseAudioQuality(sdp) {
  try {
    const lines = sdp.split("\r\n");
    let opusPayloadType = null;

    for (const line of lines) {
      const match = line.match(/^a=rtpmap:(\d+) opus\/48000/i);
      if (match) {
        opusPayloadType = match[1];
        break;
      }
    }
    if (!opusPayloadType) return sdp;

    return lines.map(line => {
      if (line.startsWith(`a=fmtp:${opusPayloadType} `) && !/maxaveragebitrate=/.test(line)) {
        return `${line};maxaveragebitrate=128000;useinbandfec=1`;
      }
      return line;
    }).join("\r\n");
  } catch (e) {
    console.warn("音声品質(Opusビットレート)の調整に失敗しました", e);
    return sdp;
  }
}

// アプリ起動時にシグナリングの受信待機を自動開始
listenSignalingMessage((fromPeerId, signalingData) => {
  handleSignalingMessage(fromPeerId, signalingData);
});

export function registerOnMessage(callback) {}
export function broadcastMessage(messageData) {}

// P2P接続の開始
export function startP2P(peerId, localStream, onRemoteStream) {
  if (peerConnections[peerId]) return;

  if (localStream) localStreamRef = localStream;
  if (onRemoteStream) onRemoteStreamRef = onRemoteStream;

  // Perfect Negotiation に必要な各ピアの状態の初期化
  const polite = myId > peerId; // IDが大きい方がpolite（譲る側）
  connectionStates[peerId] = {
    polite: polite,
    makingOffer: false,
    ignoreOffer: false,
    isSettingRemoteAnswerPending: false,
    pendingCandidates: []
  };

  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" }
    ]
  });
  peerConnections[peerId] = pc;

  const currentStream = localStream || localStreamRef;
  if (currentStream) {
    currentStream.getTracks().forEach(track => pc.addTrack(track, currentStream));
  }

  // ① onnegotiationneeded による自動Offer制御（Perfect Negotiation）
  pc.onnegotiationneeded = async () => {
    const state = connectionStates[peerId];
    if (!state) return;
    try {
      if (pc.signalingState !== "stable") {
        return; // ⑭ stable以外ならOffer生成を行わない
      }
      state.makingOffer = true;
      const offer = await pc.createOffer();
      offer.sdp = increaseAudioQuality(offer.sdp);
      await pc.setLocalDescription(offer);
      sendSignalingMessage(peerId, { type: "offer", sdp: pc.localDescription.sdp });
    } catch (err) {
      logError("Offer作成・設定送信失敗", peerId, pc, err);
    } finally {
      state.makingOffer = false;
    }
  };

  pc.ontrack = (e) => {
    if (onRemoteStreamRef) onRemoteStreamRef(peerId, e.streams[0]);
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendSignalingMessage(peerId, { type: "candidate", candidate: e.candidate.toJSON() });
    }
  };

  // ⑤ 接続状態監視
  pc.onconnectionstatechange = () => {
    const cs = pc.connectionState;
    console.log(`[P2P: ${peerId}] Connection State: ${cs}`);
    if (cs === "failed") {
      console.warn(`[P2P: ${peerId}] Connection failed. Restarting ICE...`);
      try {
        pc.restartIce();
      } catch (err) {
        logError("restartIce失敗(connectionState)", peerId, pc, err);
      }
    }
  };

  // ⑥ ICE接続状態監視
  pc.oniceconnectionstatechange = () => {
    const ics = pc.iceConnectionState;
    console.log(`[P2P: ${peerId}] ICE Connection State: ${ics}`);
    if (ics === "failed") {
      console.warn(`[P2P: ${peerId}] ICE failed. Restarting ICE...`);
      try {
        pc.restartIce();
      } catch (err) {
        logError("restartIce失敗(iceConnectionState)", peerId, pc, err);
      }
    }
  };

  // ⑦ ICE収集状態監視
  pc.onicegatheringstatechange = () => {
    console.log(`[P2P: ${peerId}] ICE Gathering State: ${pc.iceGatheringState}`);
  };
}

// シグナリングデータの処理
async function handleSignalingMessage(fromPeerId, data) {
  let pc = peerConnections[fromPeerId];
  let state = connectionStates[fromPeerId];
  
  if (!pc && data.type === "offer") {
    startP2P(fromPeerId, localStreamRef, onRemoteStreamRef);
    pc = peerConnections[fromPeerId];
    state = connectionStates[fromPeerId];
  }

  if (!pc || !state) return;

  try {
    if (data.type === "offer") {
      // Glare（衝突）検知
      const offerCollision = (data.type === "offer") && 
                             (state.makingOffer || pc.signalingState !== "stable");

      state.ignoreOffer = !state.polite && offerCollision;
      if (state.ignoreOffer) {
        console.warn(`[P2P: ${fromPeerId}] Impolite peer: Ignoring incoming offer to resolve collision.`);
        return;
      }

      state.isSettingRemoteAnswerPending = false;
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: data.sdp }));
      const answer = await pc.createAnswer();
      answer.sdp = increaseAudioQuality(answer.sdp);
      await pc.setLocalDescription(answer);
      sendSignalingMessage(fromPeerId, { type: "answer", sdp: pc.localDescription.sdp });

      // RemoteDescription 適用後に保留中だった ICE Candidate を一括処理
      const candidates = state.pendingCandidates;
      state.pendingCandidates = [];
      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          logError("保留中Candidate適用エラー", fromPeerId, pc, err);
        }
      }

    } else if (data.type === "answer") {
      // signalingStateの整合性チェック
      if (pc.signalingState !== "have-local-offer") {
        console.warn(`[P2P: ${fromPeerId}] Answer received but state is ${pc.signalingState}. Ignoring.`);
        return;
      }
      state.isSettingRemoteAnswerPending = true;
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: data.sdp }));
      state.isSettingRemoteAnswerPending = false;

      // RemoteDescription 適用後に保留中だった ICE Candidate を一括処理
      const candidates = state.pendingCandidates;
      state.pendingCandidates = [];
      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          logError("保留中Candidate適用エラー", fromPeerId, pc, err);
        }
      }

    } else if (data.type === "candidate") {
      if (!data.candidate) return; // ⑮ candidateがnullなら無視

      const readyForCandidate = pc.remoteDescription && pc.remoteDescription.type;
      if (!readyForCandidate) {
        // ③ リモート記述が未設定の間はキューへ保存
        state.pendingCandidates.push(data.candidate);
      } else {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          if (!state.ignoreOffer) {
            logError("Candidate直接適用エラー", fromPeerId, pc, err);
          }
        }
      }
    }
  } catch (err) {
    logError("シグナリング処理エラー", fromPeerId, pc, err);
  }
}

export function closeP2P(peerId) {
  if (peerConnections[peerId]) {
    const pc = peerConnections[peerId];
    try {
      // ⑩ イベントハンドラの初期化
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.onnegotiationneeded = null;
      pc.onicegatheringstatechange = null;
      
      pc.close();
    } catch(e){}
    
    delete peerConnections[peerId];
  }
  if (connectionStates[peerId]) {
    delete connectionStates[peerId];
  }
}

// ⑫ 詳細ログ出力用ユーティリティ
function logError(label, peerId, pc, err) {
  console.error(`[Error: ${label}]`, {
    peerId: peerId,
    message: err?.message || err,
    signalingState: pc ? pc.signalingState : "unknown",
    connectionState: pc ? pc.connectionState : "unknown",
    iceConnectionState: pc ? pc.iceConnectionState : "unknown"
  });
}
