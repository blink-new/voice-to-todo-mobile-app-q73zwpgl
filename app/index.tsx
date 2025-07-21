import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
  Platform,
  Animated,
  Dimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { Mic, MicOff, Check, Edit3, Trash2, Calendar, Bell } from 'lucide-react-native';
import { blink } from '@/lib/blink';

interface Task {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  completed: number;
  deadline?: string;
  reminder_enabled: number;
  reminder_time?: string;
  created_at: string;
  updated_at: string;
}

const { width: screenWidth } = Dimensions.get('window');

export default function VoiceToTodoApp() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDeadline, setEditDeadline] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [recordingDuration, setRecordingDuration] = useState(0);
  
  // Animation values
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const waveAnim1 = useRef(new Animated.Value(0.3)).current;
  const waveAnim2 = useRef(new Animated.Value(0.5)).current;
  const waveAnim3 = useRef(new Animated.Value(0.7)).current;
  const recordingTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const unsubscribe = blink.auth.onAuthStateChanged((state) => {
          setUser(state.user);
          setIsLoading(state.isLoading);
          if (state.user) {
            loadTasks();
          }
        });
        return unsubscribe;
      } catch (error) {
        console.error('Auth initialization error:', error);
        setIsLoading(false);
      }
    };

    initializeApp();
  }, []);

  // Pulse animation for recording button
  useEffect(() => {
    if (isRecording) {
      const pulseAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );
      pulseAnimation.start();

      // Wave animations
      const waveAnimation1 = Animated.loop(
        Animated.sequence([
          Animated.timing(waveAnim1, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(waveAnim1, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        ])
      );
      const waveAnimation2 = Animated.loop(
        Animated.sequence([
          Animated.timing(waveAnim2, { toValue: 0.8, duration: 800, useNativeDriver: true }),
          Animated.timing(waveAnim2, { toValue: 0.5, duration: 800, useNativeDriver: true }),
        ])
      );
      const waveAnimation3 = Animated.loop(
        Animated.sequence([
          Animated.timing(waveAnim3, { toValue: 0.9, duration: 1000, useNativeDriver: true }),
          Animated.timing(waveAnim3, { toValue: 0.7, duration: 1000, useNativeDriver: true }),
        ])
      );

      waveAnimation1.start();
      waveAnimation2.start();
      waveAnimation3.start();

      return () => {
        pulseAnimation.stop();
        waveAnimation1.stop();
        waveAnimation2.stop();
        waveAnimation3.stop();
      };
    } else {
      Animated.timing(pulseAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [isRecording]);

  const loadTasks = async () => {
    try {
      if (!user?.id) return;
      const userTasks = await blink.db.tasks.list({
        where: { user_id: user.id },
        orderBy: { created_at: 'desc' }
      });
      setTasks(userTasks);
    } catch (error) {
      console.error('Error loading tasks:', error);
    }
  };

  const startRecording = async () => {
    try {
      if (Platform.OS === 'web') {
        // Web fallback - use browser's MediaRecorder API
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          Alert.alert('Not Supported', 'Voice recording is not supported in this browser. Please use the mobile app.');
          return;
        }

        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const mediaRecorder = new MediaRecorder(stream);
          const audioChunks: Blob[] = [];

          mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
          };

          mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
            
            // Convert to base64 for transcription
            const reader = new FileReader();
            reader.onload = async () => {
              const dataUrl = reader.result as string;
              const base64Data = dataUrl.split(',')[1];
              await transcribeAudio(base64Data);
            };
            reader.readAsDataURL(audioBlob);

            // Stop all tracks
            stream.getTracks().forEach(track => track.stop());
          };

          mediaRecorder.start();
          setIsRecording(true);
          setRecordingDuration(0);

          // Start timer
          recordingTimer.current = setInterval(() => {
            setRecordingDuration(prev => prev + 1);
          }, 1000);

          // Store mediaRecorder reference for stopping
          (window as any).currentMediaRecorder = mediaRecorder;

        } catch (error) {
          Alert.alert('Permission Denied', 'Please allow microphone access to record voice notes.');
          return;
        }
        return;
      }

      // Mobile recording with Expo AV
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Permission required', 'Please grant microphone permission to record voice notes.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        android: {
          extension: '.wav',
          outputFormat: Audio.AndroidOutputFormat.DEFAULT,
          audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
        },
        ios: {
          extension: '.wav',
          outputFormat: Audio.IOSOutputFormat.LINEARPCM,
          audioQuality: Audio.IOSAudioQuality.HIGH,
        },
      });

      setRecording(recording);
      setIsRecording(true);
      setRecordingDuration(0);

      // Start timer
      recordingTimer.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('Error', 'Failed to start recording. Please try again.');
    }
  };

  const stopRecording = async () => {
    try {
      setIsRecording(false);
      setIsTranscribing(true);

      // Clear timer
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
        recordingTimer.current = null;
      }

      if (Platform.OS === 'web') {
        const mediaRecorder = (window as any).currentMediaRecorder;
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
        return;
      }

      // Mobile recording stop
      if (!recording) return;

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      
      if (uri) {
        await transcribeAudioFromFile(uri);
      }

      setRecording(null);
    } catch (error) {
      console.error('Failed to stop recording:', error);
      Alert.alert('Error', 'Failed to process recording. Please try again.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const transcribeAudioFromFile = async (audioUri: string) => {
    try {
      // Read the audio file as base64
      const audioBase64 = await FileSystem.readAsStringAsync(audioUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      await transcribeAudio(audioBase64);
    } catch (error) {
      console.error('File reading error:', error);
      Alert.alert('Error', 'Failed to read audio file. Please try again.');
    }
  };

  const transcribeAudio = async (audioBase64: string) => {
    try {
      // Transcribe using Blink AI
      const { text } = await blink.ai.transcribeAudio({
        audio: audioBase64,
        language: 'en'
      });

      if (text.trim()) {
        await createTaskFromTranscription(text.trim());
      } else {
        Alert.alert('No speech detected', 'Please try recording again with clearer speech.');
      }
    } catch (error) {
      console.error('Transcription error:', error);
      Alert.alert('Transcription failed', 'Unable to convert speech to text. Please try again.');
    }
  };

  const createTaskFromTranscription = async (transcription: string) => {
    try {
      const newTask = await blink.db.tasks.create({
        id: `task_${Date.now()}`,
        user_id: user.id,
        title: transcription,
        completed: 0,
        reminder_enabled: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      setTasks(prev => [newTask, ...prev]);
      
      // Show success feedback
      Alert.alert('Task Created!', `"${transcription}" has been added to your tasks.`);
    } catch (error) {
      console.error('Error creating task:', error);
      Alert.alert('Error', 'Failed to create task. Please try again.');
    }
  };

  const addSampleTask = async () => {
    try {
      const sampleTasks = [
        'Buy groceries for the week',
        'Call dentist to schedule appointment',
        'Finish project presentation',
        'Walk the dog in the evening',
        'Review quarterly budget',
        'Send follow-up email to client',
        'Prepare for team meeting',
        'Update portfolio website'
      ];
      
      const randomTask = sampleTasks[Math.floor(Math.random() * sampleTasks.length)];
      
      const newTask = await blink.db.tasks.create({
        id: `task_${Date.now()}`,
        user_id: user.id,
        title: randomTask,
        completed: 0,
        reminder_enabled: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      setTasks(prev => [newTask, ...prev]);
    } catch (error) {
      console.error('Error creating sample task:', error);
    }
  };

  const toggleTaskCompletion = async (task: Task) => {
    try {
      const newCompleted = task.completed ? 0 : 1;
      
      await blink.db.tasks.update(task.id, {
        completed: newCompleted,
        updated_at: new Date().toISOString()
      });

      setTasks(prev => prev.map(t => 
        t.id === task.id ? { ...t, completed: newCompleted } : t
      ));
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  const deleteTask = async (taskId: string) => {
    try {
      await blink.db.tasks.delete(taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  };

  const openEditModal = (task: Task) => {
    setEditingTask(task);
    setEditTitle(task.title);
    setEditDeadline(task.deadline || '');
    setEditModalVisible(true);
  };

  const saveTaskEdit = async () => {
    if (!editingTask) return;

    try {
      await blink.db.tasks.update(editingTask.id, {
        title: editTitle,
        deadline: editDeadline || null,
        updated_at: new Date().toISOString()
      });

      setTasks(prev => prev.map(t => 
        t.id === editingTask.id 
          ? { ...t, title: editTitle, deadline: editDeadline }
          : t
      ));

      setEditModalVisible(false);
      setEditingTask(null);
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const renderTask = ({ item }: { item: Task }) => (
    <View style={styles.taskItem}>
      <TouchableOpacity
        style={[styles.checkbox, Number(item.completed) > 0 ? styles.checkboxCompleted : null]}
        onPress={() => toggleTaskCompletion(item)}
      >
        {Number(item.completed) > 0 ? <Check size={16} color="#fff" /> : null}
      </TouchableOpacity>
      
      <View style={styles.taskContent}>
        <Text style={[
          styles.taskTitle, 
          Number(item.completed) > 0 ? styles.taskTitleCompleted : null
        ]}>
          {item.title}
        </Text>
        {item.deadline && (
          <View style={styles.taskMeta}>
            <Calendar size={12} color="#F59E0B" />
            <Text style={styles.taskDeadline}>
              Due: {new Date(item.deadline).toLocaleDateString()}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.taskActions}>
        <TouchableOpacity onPress={() => openEditModal(item)} style={styles.actionButton}>
          <Edit3 size={16} color="#6366F1" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => deleteTask(item.id)} style={styles.actionButton}>
          <Trash2 size={16} color="#EF4444" />
        </TouchableOpacity>
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Please sign in to continue</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Voice Tasks</Text>
        <Text style={styles.headerSubtitle}>
          {Platform.OS === 'web' 
            ? 'Record voice notes in your browser or add sample tasks' 
            : 'Tap to record, speak your task'
          }
        </Text>
      </View>

      {/* Recording Section */}
      <View style={styles.recordingSection}>
        {/* Voice Waveform Animation */}
        {isRecording && (
          <View style={styles.waveformContainer}>
            <Animated.View style={[styles.waveBar, { 
              height: 20,
              opacity: waveAnim1,
              transform: [{ scaleY: waveAnim1 }]
            }]} />
            <Animated.View style={[styles.waveBar, { 
              height: 35,
              opacity: waveAnim2,
              transform: [{ scaleY: waveAnim2 }]
            }]} />
            <Animated.View style={[styles.waveBar, { 
              height: 25,
              opacity: waveAnim3,
              transform: [{ scaleY: waveAnim3 }]
            }]} />
            <Animated.View style={[styles.waveBar, { 
              height: 40,
              opacity: waveAnim1,
              transform: [{ scaleY: waveAnim1 }]
            }]} />
            <Animated.View style={[styles.waveBar, { 
              height: 30,
              opacity: waveAnim2,
              transform: [{ scaleY: waveAnim2 }]
            }]} />
          </View>
        )}

        {/* Recording Button */}
        <Animated.View style={[
          styles.recordButton,
          { transform: [{ scale: pulseAnim }] }
        ]}>
          <TouchableOpacity
            style={[
              styles.recordButtonInner, 
              isRecording ? styles.recordButtonActive : null,
              isTranscribing ? styles.recordButtonProcessing : null
            ]}
            onPress={isRecording ? stopRecording : (Platform.OS === 'web' ? startRecording : startRecording)}
            disabled={isTranscribing}
          >
            {isTranscribing ? (
              <View style={styles.buttonContent}>
                <Text style={styles.recordButtonText}>Processing...</Text>
              </View>
            ) : isRecording ? (
              <View style={styles.buttonContent}>
                <MicOff size={32} color="#fff" />
                <Text style={styles.recordButtonSubtext}>Tap to stop</Text>
              </View>
            ) : (
              <View style={styles.buttonContent}>
                <Mic size={32} color="#fff" />
                <Text style={styles.recordButtonSubtext}>
                  {Platform.OS === 'web' ? 'Record Voice' : 'Record Task'}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* Recording Status */}
        {isRecording && (
          <View style={styles.recordingIndicator}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>
              Recording... {formatDuration(recordingDuration)}
            </Text>
          </View>
        )}

        {/* Web Sample Button */}
        {Platform.OS === 'web' && !isRecording && (
          <TouchableOpacity style={styles.sampleButton} onPress={addSampleTask}>
            <Text style={styles.sampleButtonText}>+ Add Sample Task</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Task List */}
      <View style={styles.taskListContainer}>
        <View style={styles.taskListHeader}>
          <Text style={styles.taskListTitle}>Your Tasks</Text>
          <View style={styles.taskCounter}>
            <Text style={styles.taskCountText}>{tasks.length}</Text>
          </View>
        </View>
        
        <FlatList
          data={tasks}
          renderItem={renderTask}
          keyExtractor={(item) => item.id}
          style={styles.taskList}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Mic size={48} color="#D1D5DB" />
              <Text style={styles.emptyStateText}>No tasks yet</Text>
              <Text style={styles.emptyStateSubtext}>
                {Platform.OS === 'web' 
                  ? 'Record your first voice note or add a sample task'
                  : 'Record your first voice note above'
                }
              </Text>
            </View>
          }
        />
      </View>

      {/* Edit Modal */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setEditModalVisible(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Edit Task</Text>
            <TouchableOpacity onPress={saveTaskEdit}>
              <Text style={styles.modalSave}>Save</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.modalContent}>
            <Text style={styles.inputLabel}>Task Title</Text>
            <TextInput
              style={styles.textInput}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Enter task title"
              multiline
            />

            <Text style={styles.inputLabel}>Deadline (Optional)</Text>
            <TextInput
              style={styles.textInput}
              value={editDeadline}
              onChangeText={setEditDeadline}
              placeholder="YYYY-MM-DD"
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
  },
  loadingText: {
    fontSize: 18,
    color: '#6B7280',
    fontWeight: '500',
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 24,
    paddingBottom: 20,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
  },
  recordingSection: {
    alignItems: 'center',
    paddingVertical: 40,
    minHeight: 200,
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    height: 50,
  },
  waveBar: {
    width: 4,
    backgroundColor: '#6366F1',
    marginHorizontal: 2,
    borderRadius: 2,
  },
  recordButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#6366F1',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  recordButtonInner: {
    width: '100%',
    height: '100%',
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordButtonActive: {
    backgroundColor: '#EF4444',
  },
  recordButtonProcessing: {
    backgroundColor: '#F59E0B',
  },
  buttonContent: {
    alignItems: 'center',
  },
  recordButtonSubtext: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
  recordButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    marginRight: 8,
  },
  recordingText: {
    fontSize: 16,
    color: '#EF4444',
    fontWeight: '500',
  },
  sampleButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#E5E7EB',
    borderRadius: 20,
  },
  sampleButtonText: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '500',
  },
  taskListContainer: {
    flex: 1,
    paddingHorizontal: 24,
  },
  taskListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  taskListTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
  },
  taskCounter: {
    backgroundColor: '#6366F1',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 24,
    alignItems: 'center',
  },
  taskCountText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  taskList: {
    flex: 1,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  checkboxCompleted: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  taskContent: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 16,
    color: '#111827',
    lineHeight: 20,
    fontWeight: '500',
  },
  taskTitleCompleted: {
    textDecorationLine: 'line-through',
    color: '#6B7280',
  },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  taskDeadline: {
    fontSize: 12,
    color: '#F59E0B',
    marginLeft: 4,
    fontWeight: '500',
  },
  taskActions: {
    flexDirection: 'row',
  },
  actionButton: {
    padding: 8,
    marginLeft: 4,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontSize: 18,
    color: '#6B7280',
    marginBottom: 4,
    marginTop: 16,
    fontWeight: '500',
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 24,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalCancel: {
    fontSize: 16,
    color: '#6B7280',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  modalSave: {
    fontSize: 16,
    color: '#6366F1',
    fontWeight: '600',
  },
  modalContent: {
    padding: 24,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
    marginBottom: 8,
    marginTop: 16,
  },
  textInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 44,
  },
});