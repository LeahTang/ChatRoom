let socket = io();
let localStream;
let teams = {}; // Will hold state for each joined team
let localName = { value: '' }; // Stores the user's name
let isMuted = false; // Global mute state

// Get DOM elements
const roomModal = document.getElementById('roomModal');
const roomInput = document.getElementById('roomInput');
const nameInput = document.getElementById('nameInput');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const mainApp = document.getElementById('mainApp');
const teamsContainer = document.getElementById('teamsContainer');
const joinAnotherTeamBtn = document.getElementById('joinAnotherTeamBtn');

// Initialize local audio once
function initLocalAudio() {
  if (!localStream) {
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false }
    })
    .then(stream => {
      localStream = stream;
      alert("Your microphone is active; speak and listen to participants.");
    })
    .catch(error => {
      console.error('Error accessing audio devices:', error);
    });
  }
}

function localReset() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  isMuted = false;
  teams = {};
  socket = io();
}

// Join a team (room)
function joinTeam(teamId, name) {
  if (teams[teamId]) {
    alert("You have already joined team " + teamId);
    return;
  }
  
  // Save team state
  teams[teamId] = { teamId, peers: {}, participants: [] };
  
  // Create UI for this team
  const teamSection = document.createElement('div');
  teamSection.id = `team-${teamId}`;
  teamSection.className = 'bg-white p-4 rounded shadow mb-4';
  teamSection.innerHTML = `
    <h3 class="text-xl font-bold mb-2">Team: ${teamId}</h3>
    <button id="ExitToggle-${teamId}" class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded shadow">
      Leave Team
    </button>
    <div class="participants mb-2"><strong>Participants:</strong>
      <div id="participants-${teamId}"></div>
    </div>
    <div class="remoteAudios mb-2">
      <div id="remoteAudios-${teamId}"></div>
    </div>
    <button id="muteToggle-${teamId}" class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded shadow">
      Mute
    </button>
  `;
  teamsContainer.appendChild(teamSection);

  let userName = document.getElementById('user-name');
  userName.textContent = name;
  
  // Emit join event for the team
  socket.emit('join-room', { roomId: teamId, name });
  
  // Setup mute toggle for this team
  const muteToggleBtn = document.getElementById(`muteToggle-${teamId}`);
  muteToggleBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
      });
    }
    muteToggleBtn.textContent = isMuted ? 'Unmute' : 'Mute';
    socket.emit('mute-status-changed', { roomId: teamId, muted: isMuted });
  });

  // Setup exit button for this team
  const exitToggleBtn = document.getElementById(`ExitToggle-${teamId}`);
  exitToggleBtn.addEventListener('click', () => {
    // Close all peer connections for this team
    for (const peerId in teams[teamId].peers) {
      teams[teamId].peers[peerId].close();
    }
    // Remove the team section from the UI
    teamSection.remove();
    
    // Delete the team state
    delete teams[teamId];

    if (Object.entries(teams).length === 0) {
      socket.close();
      localReset();
      roomModal.classList.remove('hidden');
      mainApp.classList.add('hidden');
    } else {
      // Emit leave event for the team
      socket.emit('room-leave', teamId);
    }

  });
}

// Handler for initial join button in modal
joinRoomBtn.addEventListener('click', () => {
  const enteredName = nameInput.value.trim();
  const enteredRoom = roomInput.value.trim();
  if (enteredName && enteredRoom) {
    localName.value = enteredName;
    initLocalAudio();
    joinTeam(enteredRoom, enteredName);
    roomModal.classList.add('hidden');
    mainApp.classList.remove('hidden');
  }
});

// Handler for joining another team
joinAnotherTeamBtn.addEventListener('click', () => {
  // Clear previous room input
  roomInput.value = '';
  // Show modal again (the name is preserved)
  roomModal.classList.remove('hidden');
});

// Update the participant list for a team
function updateParticipantList(teamId, participantList) {
  const container = document.getElementById(`participants-${teamId}`);
  if (container) {
    container.innerHTML = '';
    participantList.forEach(participant => {
      const elem = document.createElement('div');
      elem.textContent = `${participant.name} - ${participant.muted ? 'Muted' : 'Unmuted'}`;
      container.appendChild(elem);
    });
  }
}

// Create and configure a peer connection for a given team
function createPeerConnection(teamId, peerId, stream, isInitiator) {
  if (!teams[teamId]) return;
  if (teams[teamId].peers[peerId]) {
    console.log("Peer connection already exists for:", peerId, "in team", teamId);
    return teams[teamId].peers[peerId];
  }
  
  console.log(`Creating RTCPeerConnection for team ${teamId}, peer ${peerId}`);
  const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const peerConnection = new RTCPeerConnection(configuration);
  
  // Add local audio tracks
  if (stream) {
    stream.getTracks().forEach(track => {
      peerConnection.addTrack(track, stream);
    });
  } else {
    console.error("No local stream available for team:", teamId);
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
  
  // Handle remote tracks
  peerConnection.ontrack = event => {
    console.log("Received remote track from:", peerId, "in team:", teamId);
    const remoteAudiosContainer = document.getElementById(`remoteAudios-${teamId}`);
    let remoteAudio = document.getElementById(`audio-${teamId}-${peerId}`);
    if (!remoteAudio) {
      remoteAudio = document.createElement('audio');
      remoteAudio.id = `audio-${teamId}-${peerId}`;
      remoteAudio.autoplay = true;
      remoteAudiosContainer.appendChild(remoteAudio);
    }
    remoteAudio.srcObject = event.streams[0];
  };
  
  teams[teamId].peers[peerId] = peerConnection;
  
  if (isInitiator) {
    // Delay the offer slightly to ensure both sides have added their tracks
    setTimeout(() => {
      peerConnection.createOffer()
        .then(offer => peerConnection.setLocalDescription(offer))
        .then(() => {
          socket.emit('signal', {
            teamId,
            target: peerId,
            caller: socket.id,
            signal: peerConnection.localDescription
          });
        })
        .catch(error => console.error('Error creating offer:', error));
    }, 500);
  }
  
  return peerConnection;
}

// Socket event: update participants list
socket.on('update-participants', data => {
  // Expect data as { roomId, participants }
  const { roomId, participants } = data;
  console.log('Participant update for team', roomId, participants);
  updateParticipantList(roomId, participants);
});

// Socket event: new user connected
socket.on('user-connected', data => {
  // Expect data as { teamId, userId }
  const { teamId, userId } = data;
  console.log('User connected to team', teamId, ':', userId);
  createPeerConnection(teamId, userId, localStream, true);
});

// Socket event: signaling message
socket.on('signal', async data => {
  const { teamId, caller, signal } = data;
  if (!teams[teamId]) return;
  if (!teams[teamId].peers[caller]) {
    createPeerConnection(teamId, caller, localStream, false);
  }
  const peerConnection = teams[teamId].peers[caller];
  if (signal.type === 'offer') {
    await peerConnection.setRemoteDescription(signal);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('signal', {
      teamId,
      target: caller,
      caller: socket.id,
      signal: peerConnection.localDescription
    });
  } else if (signal.type === 'answer') {
    await peerConnection.setRemoteDescription(signal);
  } else if (signal.candidate) {
    try {
      await peerConnection.addIceCandidate(signal);
    } catch (err) {
      console.error('Error adding ICE candidate', err);
    }
  }
});

// Socket event: user disconnected
socket.on('user-disconnected', data => {
  // Expect data as { teamId, userId }
  const { teamId, userId } = data;
  console.log('User disconnected from team', teamId, ':', userId);
  if (teams[teamId] && teams[teamId].peers[userId]) {
    teams[teamId].peers[userId].close();
    delete teams[teamId].peers[userId];
    const remoteAudio = document.getElementById(`audio-${teamId}-${userId}`);
    if (remoteAudio) remoteAudio.remove();
  }
});
