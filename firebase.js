import { initializeApp }
from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";

import {
getDatabase
}
from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";

const firebaseConfig = {

apiKey:
"AIzaSyC8xaZlj3hnMNYeppvbtxZFLqw4q-9ca9g",

authDomain:
"call-a9823.firebaseapp.com",

projectId:
"call-a9823",

storageBucket:
"call-a9823.firebasestorage.app",

messagingSenderId:
"656862118456",

appId:
"1:656862118456:web:46dc8bfbdaf355ef9b9ccd",

measurementId:
"G-DRZKNJF6NY",

databaseURL:
"https://call-a9823-default-rtdb.asia-southeast1.firebasedatabase.app"

};

const app =
initializeApp(firebaseConfig);

export const db =
getDatabase(app);
