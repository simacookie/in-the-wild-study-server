const express = require('express')


// mysql2/promise gives you a Promise-based API (so you can use async/await).
// mysql2 (without /promise) is callback-based.
// …it’s much cleaner and safer to use the Promise interface.
const mysql = require("mysql2/promise");
// const mysql = require('mysql2')
const fs = require('fs')
const path = require('path')
const app = express()
const PORT = process.env.PORT || 3000;
const levenshtein = require('damerau-levenshtein');

// Middleware to parse JSON
app.use(express.json())

// ---- Load knowledge test config at server start ----
let knowledgeTestConfig = null;
let correctObjects = [];
let correctVerbs = [];

function loadKnowledgeTestConfig() {
  const configPath = path.join(__dirname, 'knowledge-test-config.json');
  try {
    const data = fs.readFileSync(configPath, 'utf8');
    knowledgeTestConfig = JSON.parse(data);
    initCorrectObjectsAndVerbsArrays();
    console.log('Knowledge test config loaded at startup.');
  } catch (err) {
    console.error('Failed to load knowledge test config at startup:', err);
  }
}

function initCorrectObjectsAndVerbsArrays() {
    const correct_answer = knowledgeTestConfig.correctAnswer;
    // Get every characters at even indices from correct_answer
    correctObjects = [];
    for (let i = 0; i < correct_answer.length; i += 2) {
      correctObjects.push(correct_answer[i]);
    }
    // Get every characters at odd indices from correct_answer
    correctVerbs = [];
    for (let i = 1; i < correct_answer.length; i += 2) {
      correctVerbs.push(correct_answer[i]);
    }
}

// Call this once at server start
loadKnowledgeTestConfig();



// GET endpoint to retrieve knowledge test configuration (objects and verbs)
app.get('/knowledge-test-config', (req, res) => {
  res.json(knowledgeTestConfig.cardpool)
})

// Endpoint to create a new user
app.get('/create-new-user', async (req,res) => {
  const query = 'INSERT INTO users () VALUES ()'
  let conn;
  try {
    conn = await dbPool.getConnection();
    const [results] = await conn.query(query);
    res.status(201).json({ 
      message: 'User created successfully',
      user_id: results.insertId
    })
  } catch (err) {
    console.error('Database error:', err)
    return res.status(500).json({ error: 'Failed to create new user' })
  } finally {
    if (conn) conn.release();
  }
})

// GET endpoint to retrieve a user by user_id
app.get('/get-user', async (req, res) => {
  const user_id = req.query.user_id
  
  // Validate required field
  if (user_id === undefined) {
    return res.status(400).json({ 
      error: 'Missing required field. Please provide: user_id' 
    })
  }
  
  const query = 'SELECT * FROM users WHERE user_id = ?'
  let conn;
  try {
    conn = await dbPool.getConnection();
    const [results] = await conn.query(query, [user_id]);
    
    if (results.length === 0) {
      return res.status(404).json({ error: 'User not found' })
    }
    
    res.status(200).json(results[0])
  } catch (err) {
    console.error('Database error:', err)
    return res.status(500).json({ error: 'Failed to retrieve user' })
  } finally {
    if (conn) conn.release();
  }
})



// Add this middleware to parse JSON requests

// POST endpoint to create a new VR nugget result
app.post('/vr-nugget-results', async (req, res) => {
  const { user_id, duration_in_seconds, number_of_errors, number_of_helps, error_stepnames, error_messages, help_stepnames} = req.body
  
  // Validate required fields
  if (user_id === undefined|| duration_in_seconds === undefined || number_of_errors === undefined || number_of_helps === undefined || error_stepnames === undefined || error_messages === undefined || help_stepnames === undefined) {
    return res.status(400).json({ 
      error: 'Missing required fields. Please provide: user_id, duration_in_seconds, number_of_errors, number_of_helps, error_stepnames, error_messages, help_stepnames' 
    })
  }
  
  const query = 'INSERT INTO vr_nugget_results (user_id, duration_in_seconds, number_of_errors, number_of_helps) VALUES (?, ?, ?, ?)'
  
  let conn;
  try {
    conn = await dbPool.getConnection();
    
    // Main insert - if this fails with duplicate entry, we return early and batch inserts won't execute
    await conn.query(query, [user_id, duration_in_seconds, number_of_errors, number_of_helps]);
    
    // Only execute batch inserts if the main insert succeeded
    const batchPromises = [];
    
    // Batch insert rows for each error_stepname with error_messages with the user_id
    if (Array.isArray(error_stepnames) && error_stepnames.length > 0) {
      const errorRows = error_stepnames.map((stepname, index) => [user_id, stepname, error_messages[index]]);
      const errorsInsertQuery = 'INSERT INTO vr_nugget_user_errors (user_id, step_name, error_message) VALUES ?';
      batchPromises.push(conn.query(errorsInsertQuery, [errorRows]));
    }

    // Batch insert rows for each help_stepname with the user_id
    if (Array.isArray(help_stepnames) && help_stepnames.length > 0) {
      const helpRows = help_stepnames.map(stepname => [user_id, stepname]);
      const helpsInsertQuery = 'INSERT INTO vr_nugget_user_helps (user_id, step_name) VALUES ?';
      batchPromises.push(conn.query(helpsInsertQuery, [helpRows]));
    }
    
    // Wait for all batch inserts to complete
    await Promise.all(batchPromises);
    
    res.status(201).json({ 
      message: 'VR nugget result created successfully',
    })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      // Error is caught and handled gracefully - no console.error for duplicate entries
      console.log('Duplicate entry for user_id:', user_id)
      return res.status(409).json({ 
        error: 'A test result for this user already exists.',
        errorCode: 'DUPLICATE_ENTRY',
        details: err.sqlMessage
      })
    }
    
    // Other database errors
    console.error('Database error:', err)
    return res.status(500).json({ 
      error: 'Failed to insert data',
      errorCode: 'DATABASE_ERROR'
    })
  } finally {
    if (conn) conn.release();
  }
})


// POST endpoint to submit knowledge test answer result
app.post('/knowledge-test-answer', async (req, res) => {
  const result = req.body.answer;
  const user_id = req.body.user_id;
  const correct_answer = knowledgeTestConfig.correctAnswer;
  // Validate required field
  if (result === undefined) {
    return res.status(400).json({ 
      error: 'Missing required field. Please provide: result' 
    });
  }
  
  // For now, just read the result string (log it)

  const levenshteinDamerauDistance = levenshtein(result, correct_answer).steps;

  const answeredObjects = [];
  const answeredVerbs = [];
  for (let i = 0; i < result.length; i += 2) {
    answeredObjects.push(result[i]);
  }
  for (let i = 1; i < result.length; i += 2) {
    answeredVerbs.push(result[i]);
  }

  let intersectionAnsweredObjectsAndCorrectObjects = [...new Set(answeredObjects.filter(object => correctObjects.includes(object)))];
  let intersectionAnsweredVerbsAndCorrectVerbs = [...new Set(answeredVerbs.filter(verb => correctVerbs.includes(verb)))];

  let unionAnsweredObjectsAndCorrectObjects = [...new Set([...answeredObjects, ...correctObjects])];
  let unionAnsweredVerbsAndCorrectVerbs = [...new Set([...answeredVerbs, ...correctVerbs])];

  let jaccardSimilarityofObjects = intersectionAnsweredObjectsAndCorrectObjects.length / unionAnsweredObjectsAndCorrectObjects.length;
  let jaccardSimilarityOfVerbs = intersectionAnsweredVerbsAndCorrectVerbs.length / unionAnsweredVerbsAndCorrectVerbs.length;

  let totalError = levenshteinDamerauDistance / (0.5 * (jaccardSimilarityofObjects + jaccardSimilarityOfVerbs));

  var invalid = result.includes('l');

  // Validate required field
  if (user_id === undefined) {
    return res.status(400).json({ 
      error: 'Missing required field. Please provide: user_id' 
    });
  }

  // Save results to database using async/await
  const query = 'INSERT INTO knowledge_test_results (user_id, total_error, levenshtein_distance, jaccard_similarity_of_objects, jaccard_similarity_of_activities, invalid) VALUES (?, ?, ?, ?, ?, ?)'
  
  let conn;
  try {
    conn = await dbPool.getConnection();
    await conn.query(query, [
      user_id, 
      Math.round(totalError), 
      levenshteinDamerauDistance, 
      jaccardSimilarityofObjects, 
      jaccardSimilarityOfVerbs,
      invalid
    ]);
    
    console.log('Total Error:', totalError)
    res.status(201).json({ 
      message: 'Knowledge test result received successfully', 
      totalError: totalError,
      levenshteinDamerauDistance: levenshteinDamerauDistance,
      jaccardSimilarityofObjects: jaccardSimilarityofObjects,
      jaccardSimilarityOfVerbs: jaccardSimilarityOfVerbs 
    })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      // Error is caught and handled gracefully - no console.error for duplicate entries
      console.log('Duplicate entry for user_id:', user_id)
      return res.status(409).json({ 
        error: 'A test result for this user already exists.',
        errorCode: 'DUPLICATE_ENTRY',
        details: err.sqlMessage
      })
    }
    
    // Other database errors
    console.error('Database error:', err)
    return res.status(500).json({ 
      error: 'Failed to insert data',
      errorCode: 'DATABASE_ERROR'
    })
  } finally {
    if (conn) conn.release();
  }
})




// SIMPLE STATUS CHECKS

// minimal route
app.get("/", (req, res) => res.send("Hello from Express !!!"));

// simple health check route for docker compose (ngnix will only start when the express.js backend started and is up and running healthy)
app.get("/health", (req, res) => res.json({ status: "ok" }));



// DATABASE

// ---- MySQL pool (reads env from docker-compose) ----
const dbPool = mysql.createPool({
  host: process.env.DB_HOST || "db",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "wild-admin",
  password: process.env.DB_PASSWORD || "arozW67Rg7HR41O1!my4Y",
  database: process.env.DB_NAME || "in-the-wild-study_db",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ---- DB connectivity check (simple ping) ----
async function checkDbConnection() {
  let conn;
  try {
    conn = await dbPool.getConnection();
    await conn.ping(); // lightweight server ping
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    if (conn) conn.release();
  }
}

// endpoint to verify DB connectivity
app.get("/db/health", async (req, res) => {
  const result = await checkDbConnection();
  if (result.ok) return res.json({ status: "ok" });
  console.error("DB health failed:", result.error);
  return res.status(500).json({ status: "error", message: result.error });
});

// OPTIONAL: fold DB status into /health as well
app.get("/health/full", async (req, res) => {
  const db = await checkDbConnection();
  const overall = db.ok ? "ok" : "degraded";
  const code = db.ok ? 200 : 503;
  res.status(code).json({ status: overall, db });
});

// graceful shutdown logs (optional)
process.on("SIGTERM", () => { console.log("SIGTERM received"); process.exit(0); });
process.on("SIGINT",  () => { console.log("SIGINT received");  process.exit(0); });


app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`)
})