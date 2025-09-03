# NanoQuiz

NanoQuiz is a lightweight, open-source quiz game platform inspired by popular online education and trivia sites. Unlike many commercial solutions locked behind paywalls, NanoQuiz is free to use, modify, and share. Use it for educational purposes, trivia nights, friendly competitions, or even as a fun party or drinking game!

## Features

- Host and join real-time quiz games in your browser
- Supports custom question sets via JSON import
- Leaderboards, timers, and answer reveal animations
- Designed for classrooms, remote teams, or social gatherings

## Installation

1. **Clone or Download the Repository**

   ```
   git clone https://github.com/yourusername/nanoquiz.git
   cd nanoquiz
   ```

2. **Install Dependencies**

   Make sure you have [Node.js](https://nodejs.org/) installed (v18 or newer recommended).

   ```
   npm install
   ```

3. **Run the Server**

   ```
   npm start
   ```

   By default, the server will run on `http://localhost:3000/host.html` (see `server.js` for host/port configuration).

4. **Access the App**

   - **Host a Game:** Open `http://<your-server-ip>:3000/host.html` in your browser.
   - **Join a Game:** Open `http://<your-server-ip>:3000/join.html` or use the join link provided by the host.

## Creating and Importing Quizzes

- Prepare your quiz as a JSON file (see `quiz_template.json` for the required format).
- When hosting a game, upload your JSON file to start.

For a collection of ready-to-use quiz JSONs, visit:  
[Quiz JSON Repository (placeholder)](https://github.com/yourusername/nanoquiz-jsons)

## License

This project is open source and free to distribute under the MIT License.  
See [LICENSE](LICENSE) for details.

> **Disclaimer:**  
> NanoQuiz is provided for educational and entertainment purposes.  
> It is not affiliated with or endorsed by any commercial quiz or education platform.

---

Enjoy learning, competing, and having fun!
