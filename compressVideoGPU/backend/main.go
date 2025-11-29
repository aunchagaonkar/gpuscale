package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	uploadDir   = "./uploads"
	staticDir   = "./static"
	frontendDir = "./frontend/dist"
	maxFileSize = 500 * 1024 * 1024
)

type VideoMetrics struct {
	Width        int               `json:"width"`
	Height       int               `json:"height"`
	Duration     float64           `json:"duration"`
	VideoCodec   string            `json:"videoCodec"`
	AudioCodec   string            `json:"audioCodec"`
	FrameRate    string            `json:"frameRate"`
	Bitrate      int64             `json:"bitrate"`
	VideoBitrate int64             `json:"videoBitrate"`
	AudioBitrate int64             `json:"audioBitrate"`
	Size         int64             `json:"size"`
	PixelFormat  string            `json:"pixelFormat"`
	ColorSpace   string            `json:"colorSpace"`
	Metadata     map[string]string `json:"metadata,omitempty"`
}

type ComparisonMetrics struct {
	Original         VideoMetrics `json:"original"`
	Compressed       VideoMetrics `json:"compressed"`
	CompressionRatio string       `json:"compressionRatio"`
	ProcessingTime   string       `json:"processingTime,omitempty"`
}

var (
	jobStatus  = make(map[string]string)
	jobMetrics = make(map[string]*ComparisonMetrics)
	jobMutex   sync.RWMutex
)

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

	for _, dir := range []string{uploadDir, staticDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			log.Fatalf("Failed to create directory %s: %v", dir, err)
		}
	}

	gin.SetMode(gin.ReleaseMode)

	router := gin.Default()

	router.Use(corsMiddleware())

	router.MaxMultipartMemory = 32 << 20

	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"service": "GPU Video Compressor API",
			"podName": os.Getenv("POD_NAME"),
		})
	})

	router.Static("/static", staticDir)

	router.POST("/upload", handleUpload)
	router.GET("/status/:jobID", handleStatus)

	if _, err := os.Stat(frontendDir); err == nil {
		router.Static("/assets", filepath.Join(frontendDir, "assets"))
		router.NoRoute(func(c *gin.Context) {
			c.File(filepath.Join(frontendDir, "index.html"))
		})
	}

	port := "8080"
	fmt.Printf(" Server starting on http://localhost:%s\n", port)
	fmt.Printf(" Upload directory: %s\n", uploadDir)
	fmt.Printf(" Static directory: %s\n", staticDir)
	fmt.Println(" Ready to accept file uploads at POST /upload")
	fmt.Println(" Status endpoint available at GET /status/:jobID")
	fmt.Println(" Compressed files served at /static/:filename")

	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func handleUpload(c *gin.Context) {

	file, err := c.FormFile("video")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "No file provided",
			"details": err.Error(),
		})
		return
	}

	if file.Size > maxFileSize {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("File too large. Maximum size is %dMB", maxFileSize/(1024*1024)),
		})
		return
	}

	jobID := uuid.New().String()

	ext := filepath.Ext(file.Filename)
	if ext == "" {
		ext = ".mp4"
	}

	inputPath := filepath.Join(uploadDir, fmt.Sprintf("%s_input%s", jobID, ext))
	if err := c.SaveUploadedFile(file, inputPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to save file",
			"details": err.Error(),
		})
		return
	}

	log.Printf("File uploaded: Job ID=%s, File=%s (%.2f MB)", jobID, file.Filename, float64(file.Size)/(1024*1024))

	setJobStatus(jobID, "processing")

	go compressVideo(jobID, inputPath)

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

	if status == "complete" {
		response["downloadURL"] = fmt.Sprintf("/static/%s_output.mp4", jobID)

		metrics := getJobMetrics(jobID)
		if metrics != nil {
			response["metrics"] = metrics
		}
	}

	c.JSON(http.StatusOK, response)
}

func compressVideo(jobID, inputPath string) {
	log.Printf("Starting GPU compression for job %s", jobID)
	startTime := time.Now()

	outputPath := filepath.Join(staticDir, fmt.Sprintf("%s_output.mp4", jobID))

	originalMetrics, err := getVideoMetrics(inputPath)
	if err != nil {
		log.Printf("Failed to get original video metrics for job %s: %v", jobID, err)
		setJobStatus(jobID, "failed")
		return
	}

	cmd := exec.Command(
		"ffmpeg",
		"-y",
		"-i", inputPath,
		"-c:v", "h264_nvenc",
		"-preset", "fast",
		"-b:v", "2M",
		"-c:a", "aac",
		"-b:a", "128k",
		outputPath,
	)

	output, err := cmd.CombinedOutput()

	if err != nil {
		log.Printf("GPU compression failed for job %s: %v\nFFmpeg output: %s", jobID, err, string(output))
		setJobStatus(jobID, "failed")
		return
	}

	compressedMetrics, err := getVideoMetrics(outputPath)
	if err != nil {
		log.Printf("Failed to get compressed video metrics for job %s: %v", jobID, err)
		setJobStatus(jobID, "failed")
		return
	}

	compressionRatio := 0.0
	if originalMetrics.Size > 0 {
		compressionRatio = float64(originalMetrics.Size-compressedMetrics.Size) / float64(originalMetrics.Size) * 100
	}

	processingTime := time.Since(startTime)

	metrics := &ComparisonMetrics{
		Original:         *originalMetrics,
		Compressed:       *compressedMetrics,
		CompressionRatio: fmt.Sprintf("%.2f", compressionRatio),
		ProcessingTime:   fmt.Sprintf("%.2fs", processingTime.Seconds()),
	}
	setJobMetrics(jobID, metrics)

	log.Printf("GPU compression completed successfully for job %s (%.2f%% reduction, %s)",
		jobID, compressionRatio, processingTime)
	setJobStatus(jobID, "complete")
}

func getVideoMetrics(filePath string) (*VideoMetrics, error) {

	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to get file info: %v", err)
	}

	cmd := exec.Command(
		"ffprobe",
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		filePath,
	)

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffprobe failed: %v", err)
	}

	var probeData struct {
		Streams []struct {
			CodecType    string `json:"codec_type"`
			CodecName    string `json:"codec_name"`
			Width        int    `json:"width"`
			Height       int    `json:"height"`
			RFrameRate   string `json:"r_frame_rate"`
			AvgFrameRate string `json:"avg_frame_rate"`
			BitRate      string `json:"bit_rate"`
			PixFmt       string `json:"pix_fmt"`
			ColorSpace   string `json:"color_space"`
		} `json:"streams"`
		Format struct {
			Duration string            `json:"duration"`
			BitRate  string            `json:"bit_rate"`
			Tags     map[string]string `json:"tags"`
		} `json:"format"`
	}

	if err := json.Unmarshal(output, &probeData); err != nil {
		return nil, fmt.Errorf("failed to parse ffprobe output: %v", err)
	}

	metrics := &VideoMetrics{
		Size:     fileInfo.Size(),
		Metadata: make(map[string]string),
	}

	if duration, err := strconv.ParseFloat(probeData.Format.Duration, 64); err == nil {
		metrics.Duration = duration
	}

	if bitrate, err := strconv.ParseInt(probeData.Format.BitRate, 10, 64); err == nil {
		metrics.Bitrate = bitrate
	}

	for key, value := range probeData.Format.Tags {
		metrics.Metadata[key] = value
	}

	for _, stream := range probeData.Streams {
		if stream.CodecType == "video" {
			metrics.Width = stream.Width
			metrics.Height = stream.Height
			metrics.VideoCodec = stream.CodecName
			metrics.PixelFormat = stream.PixFmt
			metrics.ColorSpace = stream.ColorSpace

			if stream.AvgFrameRate != "" {
				metrics.FrameRate = parseFrameRate(stream.AvgFrameRate)
			} else if stream.RFrameRate != "" {
				metrics.FrameRate = parseFrameRate(stream.RFrameRate)
			}

			if bitrate, err := strconv.ParseInt(stream.BitRate, 10, 64); err == nil {
				metrics.VideoBitrate = bitrate
			}
		} else if stream.CodecType == "audio" {
			metrics.AudioCodec = stream.CodecName

			if bitrate, err := strconv.ParseInt(stream.BitRate, 10, 64); err == nil {
				metrics.AudioBitrate = bitrate
			}
		}
	}

	return metrics, nil
}

func parseFrameRate(frameRate string) string {
	parts := strings.Split(frameRate, "/")
	if len(parts) == 2 {
		num, err1 := strconv.ParseFloat(parts[0], 64)
		den, err2 := strconv.ParseFloat(parts[1], 64)
		if err1 == nil && err2 == nil && den != 0 {
			return fmt.Sprintf("%.2f", num/den)
		}
	}
	return frameRate
}

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

func setJobMetrics(jobID string, metrics *ComparisonMetrics) {
	jobMutex.Lock()
	defer jobMutex.Unlock()
	jobMetrics[jobID] = metrics
}

func getJobMetrics(jobID string) *ComparisonMetrics {
	jobMutex.RLock()
	defer jobMutex.RUnlock()
	return jobMetrics[jobID]
}
