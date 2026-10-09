import { OpenAILiveWebRTC } from 'openai/live/webrtc';
import { TranscriptGrouper } from 'openai/helpers/live';

/**
 * Run in your browser app with a microphone or synthetic audio stream. Your
 * authenticated /session/live handler accepts an SDP offer, calls client.live.create
 * on the backend, and returns result.transport.sdp as application/sdp. See
 * docs/webrtc.md for the backend contract. Bundle this module for the browser;
 * keep the API key and backend OpenAI client on the server.
 * @param {MediaStream} stream Application-owned microphone or synthetic stream.
 * @param {(segment: import("openai/helpers/live").TranscriptSegment) => void} onUpdate Receives bubble snapshots.
 * @param {(event: RTCTrackEvent) => void} onRemoteTrack Attaches remote audio to playback.
 */
export async function connectLiveAudio(stream, onUpdate, onRemoteTrack) {
  const live = new OpenAILiveWebRTC();
  const transcript = new TranscriptGrouper();
  for (const track of stream.getTracks()) {
    live.peerConnection.addTrack(track, stream);
  }
  live.peerConnection.addEventListener('track', onRemoteTrack);
  transcript.on('segment.updated', onUpdate);
  live.onEvent((event) => transcript.push(event));
  live.onConnectionEvent((event) => {
    if (event.type === 'closed') {
      transcript.close();
    }
  });
  try {
    await live.connect({
      exchangeSdp: async (offer, { signal }) => {
        const response = await fetch('/session/live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: offer,
          signal,
        });
        if (!response.ok) {
          throw new Error(`Signaling failed: ${response.status}`);
        }
        return response.text();
      },
    });
  } catch (error) {
    transcript.close();
    live.close();
    throw error;
  }
  return {
    live,
    transcript,
    close: () => {
      live.close();
      transcript.close();
      // The application supplied this stream and owns its lifetime.
      for (const track of stream.getTracks()) {
        track.stop();
      }
    },
  };
}
