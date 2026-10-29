// ============================================================================
//  GEGK Adventure — CLOUD SAVE CONFIG (Firebase)
//  These are the web settings from the Firebase console (Project settings ->
//  Your apps). They are meant to be public: access to the saves is controlled
//  by the Firestore security rules, where each signed-in player can only read
//  and write their own document (saves/<their account id>).
//  Set this to null to turn cloud saves off.
// ============================================================================
'use strict';

G.FirebaseConfig = {
  apiKey: 'AIzaSyAT1vJbEH8s0U45aWqEuuuYzwOQfB7LDjM',
  authDomain: 'gegk-adventure.firebaseapp.com',
  projectId: 'gegk-adventure',
  storageBucket: 'gegk-adventure.firebasestorage.app',
  messagingSenderId: '455949231989',
  appId: '1:455949231989:web:f0f09f71712507a89bd53c',
  // Realtime Database: other players' positions and the chat (src/online/online.js).
  // Its rules are in docs/realtime-database.rules.json.
  databaseURL: 'https://gegk-adventure-default-rtdb.firebaseio.com',
};
