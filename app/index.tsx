import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { Mic, MicOff, Check, Edit3, Trash2 } from 'lucide-react-native';
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
        Alert.alert('Web Recording', 'Voice recording is not available on web. Please use the mobile app.');
        return;
      }

      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Permission required', 'Please grant microphone permission to record voice notes.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      setRecording(recording);
      setIsRecording(true);
    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('Error', 'Failed to start recording. Please try again.');
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    try {
      setIsRecording(false);
      setIsTranscribing(true);

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      
      if (uri) {
        await transcribeAudio(uri);
      }

      setRecording(null);
    } catch (error) {
      console.error('Failed to stop recording:', error);
      Alert.alert('Error', 'Failed to process recording. Please try again.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const transcribeAudio = async (audioUri: string) => {
    try {
      // Read the audio file as base64
      const audioBase64 = await FileSystem.readAsStringAsync(audioUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

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
        'Review quarterly budget'
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
      await blink.db.tasks.update(task.id, {
        completed: task.completed ? 0 : 1,
        updated_at: new Date().toISOString()
      });

      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, completed: task.completed ? 0 : 1 } : t));
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

  const renderTask = ({ item }: { item: Task }) => (
    <View style={styles.taskItem}>
      <TouchableOpacity
        style={[styles.checkbox, item.completed ? styles.checkboxCompleted : null]}
        onPress={() => toggleTaskCompletion(item)}
      >
        {item.completed ? <Check size={16} color="#fff" /> : null}
      </TouchableOpacity>
      
      <View style={styles.taskContent}>
        <Text style={[styles.taskTitle, item.completed ? styles.taskTitleCompleted : null]}>
          {item.title}
        </Text>
        {item.deadline && (
          <Text style={styles.taskDeadline}>
            Due: {new Date(item.deadline).toLocaleDateString()}
          </Text>
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
          {Platform.OS === 'web' ? 'Add sample tasks to test the interface' : 'Tap to record, speak your task'}
        </Text>
      </View>

      {/* Recording Button */}
      <View style={styles.recordingSection}>
        <View style={styles.recordButton}>
          <TouchableOpacity
            style={[
              styles.recordButtonInner, 
              isRecording ? styles.recordButtonActive : null,
              isTranscribing ? styles.recordButtonProcessing : null
            ]}
            onPress={Platform.OS === 'web' ? addSampleTask : (isRecording ? stopRecording : startRecording)}
            disabled={isTranscribing}
          >
            {isTranscribing ? (
              <Text style={styles.recordButtonText}>Processing...</Text>
            ) : Platform.OS === 'web' ? (
              <Text style={styles.recordButtonText}>Add Sample Task</Text>
            ) : isRecording ? (
              <MicOff size={32} color="#fff" />
            ) : (
              <Mic size={32} color="#fff" />
            )}
          </TouchableOpacity>
        </View>

        {/* Recording Indicator */}
        {isRecording && (
          <View style={styles.recordingIndicator}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>Recording...</Text>
          </View>
        )}
      </View>

      {/* Task List */}
      <View style={styles.taskListContainer}>
        <Text style={styles.taskListTitle}>Your Tasks ({tasks.length})</Text>
        <FlatList
          data={tasks}
          renderItem={renderTask}
          keyExtractor={(item) => item.id}
          style={styles.taskList}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No tasks yet</Text>
              <Text style={styles.emptyStateSubtext}>
                {Platform.OS === 'web' 
                  ? 'Tap the button above to add a sample task'
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
  },
  recordingSection: {
    alignItems: 'center',
    paddingVertical: 40,
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
  recordButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 10,
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
  taskListContainer: {
    flex: 1,
    paddingHorizontal: 24,
  },
  taskListTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 16,
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
  },
  taskTitleCompleted: {
    textDecorationLine: 'line-through',
    color: '#6B7280',
  },
  taskDeadline: {
    fontSize: 12,
    color: '#F59E0B',
    marginTop: 4,
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
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 18,
    color: '#6B7280',
    marginBottom: 4,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
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