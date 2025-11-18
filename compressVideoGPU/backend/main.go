package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	uploadDir   = "./uploads"
	staticDir   = "./static"
	frontendDir = "./frontend/dist"
	maxFileSize = 500 * 1024 * 1024 // 500MB max file size
)

// Job status tracking
var (
	jobStatus = make(map[string]string)
	jobMutex  sync.RWMutex
)

// CORS middleware to allow frontend requests
func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

func main() {
	// Create required directories
	for _, dir := range []string{uploadDir, staticDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			log.Fatalf("Failed to create directory %s: %v", dir, err)
		}
	}

	// Set Gin to release mode (can change to debug for development)
	gin.SetMode(gin.ReleaseMode)

	// Initialize Gin router
	router := gin.Default()

	// Enable CORS for frontend
	router.Use(corsMiddleware())

	// Set max multipart memory (32MB in memory, rest on disk)
	router.MaxMultipartMemory = 32 << 20

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"service": "GPU Video Compressor API",
			"podName": os.Getenv("POD_NAME"), // Read pod name from env
		})
	})

	// Serve static files (compressed videos)
	router.Static("/static", staticDir)

	// API endpoints
	router.POST("/upload", handleUpload)
	router.GET("/status/:jobID", handleStatus)

	// Serve frontend static files (if exists)
	if _, err := os.Stat(frontendDir); err == nil {
		router.Static("/assets", filepath.Join(frontendDir, "assets"))
		router.NoRoute(func(c *gin.Context) {
			c.File(filepath.Join(frontendDir, "index.html"))
		})
	}

	// Start server
	port := "8080"
	fmt.Printf("🚀 Server starting on http://localhost:%s\n", port)
	fmt.Printf("📁 Upload directory: %s\n", uploadDir)
	fmt.Printf("📦 Static directory: %s\n", staticDir)
	fmt.Println("✓ Ready to accept file uploads at POST /upload")
	fmt.Println("✓ Status endpoint available at GET /status/:jobID")
	fmt.Println("✓ Compressed files served at /static/:filename")

	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func handleUpload(c *gin.Context) {
	// Get the file from the request
	file, err := c.FormFile("video")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "No file provided",
			"details": err.Error(),
		})
		return
	}

	// Check file size
	if file.Size > maxFileSize {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("File too large. Maximum size is %dMB", maxFileSize/(1024*1024)),
		})
		return
	}

	// Generate unique job ID
	jobID := uuid.New().String()

	// Get file extension
	ext := filepath.Ext(file.Filename)
	if ext == "" {
		ext = ".mp4" // default extension
	}

	// Save file with job ID
	inputPath := filepath.Join(uploadDir, fmt.Sprintf("%s_input%s", jobID, ext))
	if err := c.SaveUploadedFile(file, inputPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to save file",
			"details": err.Error(),
		})
		return
	}

	log.Printf("File uploaded: Job ID=%s, File=%s (%.2f MB)", jobID, file.Filename, float64(file.Size)/(1024*1024))

	// Set initial job status
	setJobStatus(jobID, "processing")

	// Start compression in goroutine
	go compressVideo(jobID, inputPath)

	// Return job ID immediately
	c.JSON(http.StatusOK, gin.H{
		"jobID":    jobID,
		"message":  "File uploaded successfully. Compression started.",
		"filename": file.Filename,
		"size":     file.Size,
	})
}

func handleStatus(c *gin.Context) {
	jobID := c.Param("jobID")

	status := getJobStatus(jobID)
	if status == "" {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Job ID not found",
		})
		return
	}

	response := gin.H{
		"jobID":  jobID,
		"status": status,
	}

	// If complete, include download URL
	if status == "complete" {
		response["downloadURL"] = fmt.Sprintf("/static/%s_output.mp4", jobID)
	}

	c.JSON(http.StatusOK, response)
}

func compressVideo(jobID, inputPath string) {
	log.Printf("Starting GPU compression for job %s", jobID)

	// Output path in static directory
	outputPath := filepath.Join(staticDir, fmt.Sprintf("%s_output.mp4", jobID))

	// Build ffmpeg command with GPU acceleration (NVENC)
	// CPU decoding + GPU encoding (more compatible)
	cmd := exec.Command(
		"ffmpeg",
		"-y",            // Overwrite output file
		"-i", inputPath, // Input file
		"-c:v", "h264_nvenc", // Use NVIDIA GPU encoder (NVENC)
		"-preset", "fast", // Encoding preset (fast, medium, slow)
		"-b:v", "2M", // Video bitrate
		"-c:a", "aac", // Audio codec
		"-b:a", "128k", // Audio bitrate
		outputPath, // Output file
	)

	// Capture output for logging
	output, err := cmd.CombinedOutput()

	if err != nil {
		log.Printf("GPU compression failed for job %s: %v\nFFmpeg output: %s", jobID, err, string(output))
		setJobStatus(jobID, "failed")
		return
	}

	log.Printf("GPU compression completed successfully for job %s", jobID)
	setJobStatus(jobID, "complete")
}

// Thread-safe job status getters/setters
func setJobStatus(jobID, status string) {
	jobMutex.Lock()
	defer jobMutex.Unlock()
	jobStatus[jobID] = status
}

func getJobStatus(jobID string) string {
	jobMutex.RLock()
	defer jobMutex.RUnlock()
	return jobStatus[jobID]
}
