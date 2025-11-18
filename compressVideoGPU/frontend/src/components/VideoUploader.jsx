import { useState, useEffect } from 'react';
import axios from 'axios';
import './VideoUploader.css';

// Use environment variable or fallback to localhost for development
const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8080' : '');

const VideoUploader = () => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadPercentage, setUploadPercentage] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [podName, setPodName] = useState(null);
  // Job tracking
  const [jobID, setJobID] = useState(null);
  const [jobStatus, setJobStatus] = useState(null); // 'processing', 'complete', 'failed'
  const [downloadURL, setDownloadURL] = useState(null);

  // Poll job status every 2 seconds when jobID is set
  useEffect(() => {
    if (!jobID || jobStatus === 'complete' || jobStatus === 'failed') {
      return;
    }

    const pollStatus = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/status/${jobID}`);
        setJobStatus(response.data.status);
        
        if (response.data.status === 'complete') {
          setDownloadURL(response.data.downloadURL);
        }
      } catch (err) {
        console.error('Status polling error:', err);
        setError('Failed to check compression status');
      }
    };

    // Poll immediately, then every 2 seconds
    pollStatus();
    const interval = setInterval(pollStatus, 2000);

    // Cleanup interval on unmount or when status changes
    return () => clearInterval(interval);
  }, [jobID, jobStatus]);
  useEffect(() => {
    const fetchPodName = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/health`);
        if (response.data.podName) {
          setPodName(response.data.podName);
        }
      } catch (err) {
        console.error('Failed to fetch pod name:', err);
      }
    };
    fetchPodName();
  }, []);
  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('video/')) {
        setError('Please select a valid video file');
        setSelectedFile(null);
        return;
      }
      
      // Reset all states
      setSelectedFile(file);
      setError(null);
      setUploadPercentage(0);
      setJobID(null);
      setJobStatus(null);
      setDownloadURL(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Please select a video file first');
      return;
    }

    // Create FormData object
    const formData = new FormData();
    formData.append('video', selectedFile);

    setUploading(true);
    setError(null);
    setJobStatus(null);

    try {
      // Send file to backend with progress tracking
      const response = await axios.post(`${API_BASE_URL}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          setUploadPercentage(percentCompleted);
        },
      });

      // Handle successful upload - start tracking compression
      setJobID(response.data.jobID);
      setJobStatus('processing');
      console.log('Upload successful, job ID:', response.data.jobID);
    } catch (err) {
      console.error('Upload error:', err);
      setError(err.response?.data?.error || 'Upload failed. Please try again.');
      setUploadPercentage(0);
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = () => {
    if (downloadURL) {
      window.open(`${API_BASE_URL}${downloadURL}`, '_blank');
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setUploadPercentage(0);
    setJobID(null);
    setJobStatus(null);
    setDownloadURL(null);
    setError(null);
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="video-uploader">
      <h1>GPU Video Compressor</h1>
      <p className="subtitle">Upload your video to compress it using GPU acceleration</p>
      {podName && <p className="pod-name">Served by Pod: <strong>{podName}</strong></p>}
      <div className="upload-container">
        <div className="file-input-wrapper">
          <input
            type="file"
            id="video-input"
            accept="video/*"
            onChange={handleFileSelect}
            disabled={uploading}
          />
          <label htmlFor="video-input" className={uploading ? 'disabled' : ''}>
            Choose Video File
          </label>
        </div>

        {selectedFile && (
          <div className="file-info">
            <p><strong>Selected:</strong> {selectedFile.name}</p>
            <p><strong>Size:</strong> {formatFileSize(selectedFile.size)}</p>
            <p><strong>Type:</strong> {selectedFile.type}</p>
          </div>
        )}

        <button
          className="compress-button"
          onClick={handleUpload}
          disabled={!selectedFile || uploading}
        >
          {uploading ? ' Uploading...' : ' Compress Video'}
        </button>

        {/* Upload Progress */}
        {uploading && (
          <div className="progress-container">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${uploadPercentage}%` }}
              >
                <span className="progress-text">{uploadPercentage}%</span>
              </div>
            </div>
            <p className="progress-label">Uploading... {uploadPercentage}%</p>
          </div>
        )}

        {/* Compression Status */}
        {jobStatus === 'processing' && (
          <div className="processing-message">
            <div className="spinner"></div>
            <h3>Compressing Video...</h3>
            <p>Your video is being compressed using GPU acceleration.</p>
            <p className="job-id">Job ID: {jobID}</p>
          </div>
        )}

        {/* Completion with Download */}
        {jobStatus === 'complete' && (
          <div className="success-message">
            <h3>Compression Complete!</h3>
            <p>Your video has been successfully compressed using GPU acceleration.</p>
            <div className="download-actions">
              <button className="download-button" onClick={handleDownload}>
                Download Compressed Video
              </button>
              <button className="reset-button" onClick={handleReset}>
                Compress Another Video
              </button>
            </div>
            <p className="download-hint">
              Direct link: <a href={`${API_BASE_URL}${downloadURL}`} target="_blank" rel="noopener noreferrer">
                {downloadURL}
              </a>
            </p>
          </div>
        )}

        {/* Failed Status */}
        {jobStatus === 'failed' && (
          <div className="error-message">
            <h3>Compression Failed</h3>
            <p>The video compression process failed. This could be due to:</p>
            <ul>
              <li>Unsupported video format</li>
              <li>Corrupted video file</li>
              <li>Server processing error</li>
            </ul>
            <button className="reset-button" onClick={handleReset}>
              Try Again
            </button>
          </div>
        )}

        {/* General Errors */}
        {error && !jobStatus && (
          <div className="error-message">
            <h3>Error</h3>
            <p>{error}</p>
          </div>
        )}
      </div>

      <div className="features">
        <h3>Features:</h3>
        <ul>
          <li>GPU-accelerated compression (NVIDIA NVENC)</li>
          <li>Real-time upload progress tracking</li>
          <li>Fast processing with hardware encoding</li>
          <li>Supports all common video formats</li>
        </ul>
      </div>
    </div>
  );
};

export default VideoUploader;
