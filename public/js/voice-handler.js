const socket = io();

// Global variables
let roomId = '';
let localStream;
let isMuted = false; // Local mute state

// UI Elements
const roomModal = document.getElementById('roomModal');
const roomInput = document.getElementById('roomInput');
const nameInput = document.getElementById('nameInput');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const mainApp = document.getElementById('mainApp');
const localAudioContainer = document.getElementById('localAudioContainer');
const remoteAudios = document.getElementById('remoteAudios');
const participantsDiv = document.getElementById('participants');
const muteToggleBtn = document.getElementById('muteToggle');

// Object to track peer connections (keyed by peerId)
const peers = {};

// When a participant list update is received
socket.on('update-participants', participantList => {
  console.log('Received participant list: ', participantList);
  updateParticipantList(participantList);
});

// When a new user connects, create a peer connection using the current roomId.
socket.on('user-connected', userId => {
  console.log('User connected:', userId);
  // Pass the current roomId, userId as peerId, and localStream.
  createPeerConnection(roomId, userId, localStream, true);
});

// When receiving signaling messages
socket.on('signal', async data => {
  const { caller, signal } = data;
  // Since this is a single-team app, we use the global roomId.
  if (!peers[caller]) {
    // Ensure local stream is available (it should be already)
    createPeerConnection(roomId, caller, localStream, false);
  }
  if (signal.type === 'offer') {
    await peers[caller].setRemoteDescription(signal);
    const answer = await peers[caller].createAnswer();
    await peers[caller].setLocalDescription(answer);
    socket.emit('signal', { target: caller, caller: socket.id, signal: peers[caller].localDescription });
  } else if (signal.type === 'answer') {
    await peers[caller].setRemoteDescription(signal);
  } else if (signal.candidate) {
    try {
      await peers[caller].addIceCandidate(signal);
    } catch (err) {
      console.error('Error adding ICE candidate', err);
    }
  }
});

// Handler for Join Room button
joinRoomBtn.addEventListener('click', () => {
  const enteredName = nameInput.value.trim();
  const enteredRoom = roomInput.value.trim();
  if (enteredName && enteredRoom) {
    roomId = enteredRoom;
    socket.emit('join-room', { roomId, name: enteredName });
    roomModal.classList.add('hidden');
    mainApp.classList.remove('hidden');
    // Start audio and ensure localStream is available
    startAudio();
  }
});

// Function to start audio and set up local stream
function startAudio() {
  navigator.mediaDevices.getUserMedia({ 
      audio: {
    echoCancellation: false,
    noiseSuppression: false
  }
   })
    .then(stream => {
      localStream = stream;
      const localAudio = document.createElement('audio');
      localAudio.controls = false;
      localAudio.muted = true; // Mute local playback to prevent echo
      localAudio.autoplay = true;
      localAudio.srcObject = stream;
      localAudioContainer.appendChild(localAudio);
      alert("Your microphone is active; speak and listen to other participants.");
    })
    .catch(error => {
      console.error('Error accessing audio devices:', error);
    });
}

// Function to update the participant list UI
function updateParticipantList(list) {
  participantsDiv.innerHTML = ''; // Clear the list
  list.forEach(participant => {
    const participantElem = document.createElement('div');
    participantElem.className = 'p-2 bg-white rounded shadow';
    participantElem.textContent = `${participant.name} - ${participant.muted ? 'Muted' : 'Unmuted'}`;
    participantsDiv.appendChild(participantElem);
  });
}


// Toggle mute and notify the server
muteToggleBtn.addEventListener('click', () => {
  isMuted = !isMuted;
  if (localStream) {
    localStream.getAudioTracks().forEach(track => {
      // Use track.enabled instead of track.muted
      track.enabled = !isMuted;
    });
  }
  muteToggleBtn.textContent = isMuted ? 'Unmute' : 'Mute';
  socket.emit('mute-status-changed', { roomId, muted: isMuted });
});



// Function to create and configure a peer connection
function createPeerConnection(teamId, peerId, stream, isInitiator) {

  if (peers[peerId]) {
    console.log("Peer connection already exists for:", peerId);
    return peers[peerId];
  }
  
  console.log(`Creating RTCPeerConnection for team: ${teamId}, peer: ${peerId}, initiator: ${isInitiator}`);
  const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const peerConnection = new RTCPeerConnection(configuration);

  // Add local audio tracks
  if (stream) {
    stream.getTracks().forEach(track => {
      console.log("Adding track to connection:", track);
      peerConnection.addTrack(track, stream);
    });
  } else {
    console.error("No local stream available when creating peer connection!");
  }

  // Handle ICE candidates
  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      socket.emit('signal', {
        teamId,
        target: peerId,
        caller: socket.id,
        signal: event.candidate
      });
    }
  };

  // Handle remote track: attach to remote audio element
  peerConnection.ontrack = event => {
    console.log("Received remote track from:", peerId, "team:", teamId);
    // Create (or use existing) remote audio element
    let remoteAudio = document.getElementById(`audio-${peerId}`);
    if (!remoteAudio) {
      remoteAudio = document.createElement('audio');
      remoteAudio.id = `audio-${peerId}`;
      remoteAudio.controls = false;
      remoteAudio.autoplay = true;
      remoteAudios.appendChild(remoteAudio);
    }
    remoteAudio.srcObject = event.streams[0];
  };

  // Save connection
  peers[peerId] = peerConnection;

  if (isInitiator) {
    peerConnection.createOffer()
      .then(offer => {
        console.log("Created offer for peer:", peerId);
        return peerConnection.setLocalDescription(offer);
      })
      .then(() => {
        socket.emit('signal', {
          teamId,
          target: peerId,
          caller: socket.id,
          signal: peerConnection.localDescription
        });
      })
      .catch(error => console.error('Error creating offer:', error));
  }
}
