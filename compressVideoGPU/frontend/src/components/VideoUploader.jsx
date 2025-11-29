import { useState, useEffect } from 'react';
import axios from 'axios';
import './VideoUploader.css';


const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8080' : '');

const VideoUploader = () => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadPercentage, setUploadPercentage] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [podName, setPodName] = useState(null);
  
  const [jobID, setJobID] = useState(null);
  const [jobStatus, setJobStatus] = useState(null); 
  const [downloadURL, setDownloadURL] = useState(null);
  const [videoMetrics, setVideoMetrics] = useState(null);
  const [originalVideoURL, setOriginalVideoURL] = useState(null);

  
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
          setVideoMetrics(response.data.metrics);
        }
      } catch (err) {
        console.error('Status polling error:', err);
        setError('Failed to check compression status');
      }
    };

    
    pollStatus();
    const interval = setInterval(pollStatus, 2000);

    
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
      
      if (!file.type.startsWith('video/')) {
        setError('Please select a valid video file');
        setSelectedFile(null);
        return;
      }

      
      setSelectedFile(file);
      setError(null);
      setUploadPercentage(0);
      setJobID(null);
      setJobStatus(null);
      setDownloadURL(null);
      setVideoMetrics(null);
      
      
      if (originalVideoURL) {
        URL.revokeObjectURL(originalVideoURL);
      }
      const url = URL.createObjectURL(file);
      setOriginalVideoURL(url);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Please select a video file first');
      return;
    }

    
    const formData = new FormData();
    formData.append('video', selectedFile);

    setUploading(true);
    setError(null);
    setJobStatus(null);

    try {
      
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
    setVideoMetrics(null);
    
    
    if (originalVideoURL) {
      URL.revokeObjectURL(originalVideoURL);
      setOriginalVideoURL(null);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDuration = (seconds) => {
    if (!seconds || seconds === 0) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatBitrate = (bitrate) => {
    if (!bitrate || bitrate === 0) return 'N/A';
    const kbps = bitrate / 1000;
    if (kbps >= 1000) {
      return `${(kbps / 1000).toFixed(2)} Mbps`;
    }
    return `${kbps.toFixed(2)} kbps`;
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

        
        {jobStatus === 'processing' && (
          <div className="processing-message">
            <div className="spinner"></div>
            <h3>Compressing Video...</h3>
            <p>Your video is being compressed using GPU acceleration.</p>
            <p className="job-id">Job ID: {jobID}</p>
          </div>
        )}

        
        {jobStatus === 'complete' && (
          <div className="success-message">
            <h3>Compression Complete!</h3>
            <p>Your video has been successfully compressed using GPU acceleration.</p>
            
            
            <div className="video-comparison">
              <div className="comparison-header">
                <h3> Video Comparison</h3>
              </div>
              
              <div className="video-players">
                <div className="video-player-container">
                  <h4>Original Video</h4>
                  {originalVideoURL && (
                    <video controls className="comparison-video">
                      <source src={originalVideoURL} type={selectedFile.type} />
                      Your browser does not support the video tag.
                    </video>
                  )}
                </div>
                
                <div className="video-player-container">
                  <h4>Compressed Video</h4>
                  {downloadURL && (
                    <video controls className="comparison-video">
                      <source src={`${API_BASE_URL}${downloadURL}`} type="video/mp4" />
                      Your browser does not support the video tag.
                    </video>
                  )}
                </div>
              </div>
              
              
              {videoMetrics && (
                <div className="metrics-section">
                  <h3>Detailed Metrics</h3>
                  
                  
                  <div className="metric-category">
                    <h4>File Size</h4>
                    <div className="metric-grid">
                      <div className="metric-item">
                        <span className="metric-label">Original Size:</span>
                        <span className="metric-value original">{formatFileSize(videoMetrics.original.size)}</span>
                      </div>
                      <div className="metric-item">
                        <span className="metric-label">Compressed Size:</span>
                        <span className="metric-value compressed">{formatFileSize(videoMetrics.compressed.size)}</span>
                      </div>
                      <div className="metric-item highlight">
                        <span className="metric-label">Size Reduction:</span>
                        <span className="metric-value savings">
                          {formatFileSize(videoMetrics.original.size - videoMetrics.compressed.size)} 
                          ({videoMetrics.compressionRatio}%)
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  
                  <div className="metric-category">
                    <h4>Video Properties</h4>
                    <div className="metric-comparison-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Property</th>
                            <th>Original</th>
                            <th>Compressed</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>Resolution</td>
                            <td>{videoMetrics.original.width}x{videoMetrics.original.height}</td>
                            <td>{videoMetrics.compressed.width}x{videoMetrics.compressed.height}</td>
                          </tr>
                          <tr>
                            <td>Duration</td>
                            <td>{formatDuration(videoMetrics.original.duration)}</td>
                            <td>{formatDuration(videoMetrics.compressed.duration)}</td>
                          </tr>
                          <tr>
                            <td>Video Codec</td>
                            <td>{videoMetrics.original.videoCodec}</td>
                            <td>{videoMetrics.compressed.videoCodec}</td>
                          </tr>
                          <tr>
                            <td>Audio Codec</td>
                            <td>{videoMetrics.original.audioCodec || 'N/A'}</td>
                            <td>{videoMetrics.compressed.audioCodec || 'N/A'}</td>
                          </tr>
                          <tr>
                            <td>Frame Rate</td>
                            <td>{videoMetrics.original.frameRate} fps</td>
                            <td>{videoMetrics.compressed.frameRate} fps</td>
                          </tr>
                          <tr>
                            <td>Video Bitrate</td>
                            <td>{formatBitrate(videoMetrics.original.videoBitrate)}</td>
                            <td>{formatBitrate(videoMetrics.compressed.videoBitrate)}</td>
                          </tr>
                          <tr>
                            <td>Audio Bitrate</td>
                            <td>{formatBitrate(videoMetrics.original.audioBitrate)}</td>
                            <td>{formatBitrate(videoMetrics.compressed.audioBitrate)}</td>
                          </tr>
                          <tr>
                            <td>Total Bitrate</td>
                            <td>{formatBitrate(videoMetrics.original.bitrate)}</td>
                            <td>{formatBitrate(videoMetrics.compressed.bitrate)}</td>
                          </tr>
                          <tr>
                            <td>Pixel Format</td>
                            <td>{videoMetrics.original.pixelFormat || 'N/A'}</td>
                            <td>{videoMetrics.compressed.pixelFormat || 'N/A'}</td>
                          </tr>
                          <tr>
                            <td>Color Space</td>
                            <td>{videoMetrics.original.colorSpace || 'N/A'}</td>
                            <td>{videoMetrics.compressed.colorSpace || 'N/A'}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  
                  
                  {(videoMetrics.original.metadata || videoMetrics.compressed.metadata) && (
                    <div className="metric-category">
                      <h4>Additional Metadata</h4>
                      <div className="metadata-grid">
                        {videoMetrics.original.metadata && Object.entries(videoMetrics.original.metadata).map(([key, value]) => (
                          <div key={key} className="metadata-item">
                            <span className="metadata-key">{key}:</span>
                            <span className="metadata-value">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  
                  <div className="compression-summary">
                    <h4> Compression Summary</h4>
                    <div className="summary-stats">
                      <div className="stat-box">
                        <div className="stat-icon">📉</div>
                        <div className="stat-content">
                          <div className="stat-label">Space Saved</div>
                          <div className="stat-value">{videoMetrics.compressionRatio}%</div>
                        </div>
                      </div>
                      <div className="stat-box">
                        <div className="stat-icon">⚡</div>
                        <div className="stat-content">
                          <div className="stat-label">Processing Time</div>
                          <div className="stat-value">{videoMetrics.processingTime || 'N/A'}</div>
                        </div>
                      </div>
                      <div className="stat-box">
                        <div className="stat-icon">🎯</div>
                        <div className="stat-content">
                          <div className="stat-label">Quality Retained</div>
                          <div className="stat-value">High</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            <div className="download-actions">
              <button className="download-button" onClick={handleDownload}>
                📥 Download Compressed Video
              </button>
              <button className="reset-button" onClick={handleReset}>
                🔄 Compress Another Video
              </button>
            </div>
          </div>
        )}

        
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
