import { Buffer } from 'buffer'; // Run: npm install buffer
import { useEffect, useState } from 'react';
import {
  Alert, FlatList, PermissionsAndroid, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View, Pressable
} from 'react-native';
import { BleManager, Device } from 'react-native-ble-plx';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';

const manager = new BleManager();

// Replace these with your target device's UUIDs
const SERVICE_UUID = 'aee04821-1973-4e1f-a590-e84b10d580e7';
const CHAR_UUID = 'cde07b1a-889b-44b7-a99f-c888dddac729'; 
const CHAR_UUID_NOTIFY = 'cde07b1a-889b-44b7-a99f-c888dddac729';

// Bouncy Button Component
const BouncyButton = ({ onPress, title, style, textStyle, disabled = false }: any) => {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: disabled ? 0.5 : 1
  }));

  return (
    <Animated.View style={[animatedStyle, style]}>
      <Pressable
        disabled={disabled}
        onPressIn={() => { scale.value = withSpring(0.9); }}
        onPressOut={() => { scale.value = withSpring(1); }}
        onPress={onPress}
        style={styles.bouncyButton}
      >
        <Text style={[styles.bouncyButtonText, textStyle]}>{title}</Text>
      </Pressable>
    </Animated.View>
  );
};

export default function Index() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [receivedData, setReceivedData] = useState<string>('');
  const [writeValue, setWriteValue] = useState<string>('');

  async function requestPermissions() {
    manager.stopDeviceScan();
    if (Platform.OS === 'android') { 
      if (Platform.Version >= 31) {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        return (
          granted['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
          granted['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
          granted['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED
        );
      } else { 
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    }
    return true; 
  }

  useEffect(() => { 
    requestPermissions().then((granted) => {
      if (!granted) {
        console.log('Bluetooth permissions not granted');
      }
    });
    return () => {
      manager.stopDeviceScan();
    };
  }, []);


  const startScan = () => {
    setDevices([]);
    manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.log('Scan error:', error);
        return;
      }
      if (device && device.name) {
        setDevices((prevDevices) => {
          if (prevDevices.some((d) => d.id === device.id)) return prevDevices;
          return [...prevDevices, device];
        });
      }
    });
  };

  const connectToDevice = async (device: Device) => {
    manager.stopDeviceScan();
    try {
      const connected = await manager.connectToDevice(device.id);
      const discovered = await connected.discoverAllServicesAndCharacteristics();
      setConnectedDevice(discovered);
      console.log('Connected to:', discovered.name);
      
      try {
        const services = await discovered.services();
        for (const service of services) {
          const characteristics = await service.characteristics();
          for (const c of characteristics) {
            console.log(`Service: ${service.uuid}, Char: ${c.uuid} | Readable: ${c.isReadable} | Writable: ${c.isWritableWithResponse} | Notifiable: ${c.isNotifiable}`);
          }
        }
      } catch (e) {
        console.log('Error reading services:', e);
      }

      manager.onDeviceDisconnected(device.id, (error, disconnectedDevice) => {
         console.log('Device disconnected', error);
         Alert.alert('Disconnected', 'The device has disconnected.');
         setConnectedDevice(null);
      });
      
    } catch (error) {
      console.log('Connection failed:', error);
      Alert.alert('Connection failed', String(error));
    }
  };

  const readCharacteristic = async () => {
    if (!connectedDevice) return;
    try {
      const device_id:string = connectedDevice.id.toString();
      const characteristic = await manager.readCharacteristicForDevice(
        device_id,
        SERVICE_UUID,
        CHAR_UUID
      );
      const rawData = Buffer.from(characteristic.value || '', 'base64').toString('ascii');
      setReceivedData(`Read Value: ${rawData}`);
      console.log('Read Value:', rawData);
    } catch (error: any) {
      console.log('Read failed:', error);
      const errorMsg = `Reason: ${error.reason || error.message}\nCode: ${error.errorCode}\nATT: ${error.attErrorCode}`;
      Alert.alert('Read failed', errorMsg);
    }
  };

  const writeCharacteristic = async () => {
    if (!connectedDevice) return;
    if (!writeValue) {
      Alert.alert('Input Error', 'Please enter a value to write.');
      return;
    } 
    try {
      const base64Value = Buffer.from(writeValue, 'utf-8').toString('base64');
      const device_id:string = connectedDevice.id.toString();

      try {
        await manager.writeCharacteristicWithResponseForDevice( device_id, SERVICE_UUID, CHAR_UUID, base64Value);
      } catch (err) {
        console.log('Write with response failed, trying without response', err);
        await manager.writeCharacteristicWithoutResponseForDevice( device_id, SERVICE_UUID, CHAR_UUID, base64Value);
      }
      Alert.alert('Write Success', `Value "${writeValue}" written successfully.`);
      setWriteValue(''); 
    } catch (error) {
      console.log('Write failed:', error);
      Alert.alert('Write failed', String(error));
    }
  };

  const startNotificationStream = () => {
    if (!connectedDevice) return;
    manager.monitorCharacteristicForDevice(connectedDevice.id, SERVICE_UUID, CHAR_UUID_NOTIFY,
      (error, char) => {
        if (error) {
          console.log('Notification error:', error);
          return;
        }
        if (char?.value) {
          const rawData = Buffer.from(char.value, 'base64').toString('ascii');
          setReceivedData(`Live Stream: ${rawData}`);
        }
      }
    );
  };

  const disconnectDevice = async () => {
    if (!connectedDevice) return; 
    await manager.cancelDeviceConnection(connectedDevice.id);
    setConnectedDevice(null);
    Alert.alert('Disconnected', 'Device has been disconnected.');
  };

  return (
    <View style={styles.container}>
      {/* Decorative Floating Elements (Y2K / Quirky Style) */}
      <Text style={[styles.floatingEmoji, { top: 60, left: 20, transform: [{rotate: '-15deg'}] }]}>⭐</Text>
      <Text style={[styles.floatingEmoji, { top: 120, right: 30, transform: [{rotate: '20deg'}] }]}>🍓</Text>
      <Text style={[styles.floatingEmoji, { bottom: 150, left: 30, transform: [{rotate: '25deg'}] }]}>☁️</Text>
      <Text style={[styles.floatingEmoji, { bottom: 80, right: 40, transform: [{rotate: '-10deg'}] }]}>🍒</Text>

      <Text style={styles.headerTitle}>BLE SCANNER</Text>

      {!connectedDevice ? (
        <View style={styles.scanContainer}>
          <BouncyButton title="Scan Devices 🔍" onPress={startScan} style={{marginBottom: 20}} />
          <FlatList
            data={devices}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{gap: 15}}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.deviceCard} onPress={() => connectToDevice(item)}>
                {item.isConnectable ? (
                  <>
                    <Text style={styles.deviceName}>{item.name || "Unknown Device"}</Text>
                    <View style={styles.deviceInfoRow}>
                      <Text style={styles.deviceInfoText}>ID: {item.id}</Text>
                      <View style={styles.rssiBadge}>
                        <Text style={styles.rssiText}>{item.rssi} dBm</Text>
                      </View>
                    </View>
                  </>
                ) : (
                  <Text style={styles.deviceName}>---</Text>
                )}
              </TouchableOpacity>
            )}
          />
        </View>
      ) : (
        <View style={styles.dashboard}>
          <View style={styles.statusCard}>
            <Text style={styles.statusTitle}>Connected to</Text>
            <Text style={styles.statusName}>{connectedDevice.name || "Unknown"}</Text>
          </View>

          <View style={styles.dataCard}>
            <Text style={styles.dataTitle}>Data Received</Text>
            <Text style={styles.dataBox}>{receivedData || "No data fetched yet ☁️"}</Text>
            <BouncyButton title="Read Value 📥" onPress={readCharacteristic} style={{marginTop: 15}} />          
          </View>

          <View style={styles.actionCard}>
            <Text style={styles.actionTitle}>Send Data</Text>
            <TextInput 
                style={styles.input} 
                value={writeValue} 
                onChangeText={setWriteValue} 
                placeholder="Enter value..." 
                placeholderTextColor="#999"
            />  
            <BouncyButton title="Write Value 📤" onPress={writeCharacteristic} />
          </View>

          <BouncyButton disabled={true} title="Subscribe 🔔" onPress={startNotificationStream} style={{marginTop: 10, backgroundColor: '#E0E0E0'}} textStyle={{color: '#888'}} />
          <BouncyButton title="Disconnect 💔" onPress={disconnectDevice} style={{marginTop: 10, backgroundColor: '#FF6B6B'}} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 20, backgroundColor: '#FDFBF7' },
  headerTitle: { fontSize: 32, fontWeight: '900', color: '#111', textAlign: 'center', marginBottom: 25, letterSpacing: -1 },
  floatingEmoji: { position: 'absolute', fontSize: 40, opacity: 0.9, zIndex: 0 },
  scanContainer: { flex: 1, zIndex: 10 },
  deviceCard: { 
    backgroundColor: '#fff', padding: 20, borderRadius: 24, 
    shadowColor: '#000', shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.04, shadowRadius: 10, elevation: 2,
    borderWidth: 1, borderColor: '#F0F0F0'
  },
  deviceName: { fontSize: 18, fontWeight: '900', color: '#222', marginBottom: 8 },
  deviceInfoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deviceInfoText: { fontSize: 12, color: '#888', fontWeight: '500' },
  rssiBadge: { backgroundColor: '#E3F2FD', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  rssiText: { fontSize: 12, fontWeight: 'bold', color: '#1976D2' },
  
  dashboard: { gap: 15, flex: 1, zIndex: 10 },
  statusCard: { backgroundColor: '#FFF0F5', padding: 20, borderRadius: 24, alignItems: 'center' },
  statusTitle: { fontSize: 12, color: '#777', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 },
  statusName: { fontSize: 26, fontWeight: '900', color: '#FF6B6B', marginTop: 5 },
  
  dataCard: { backgroundColor: '#fff', padding: 20, borderRadius: 24, borderWidth: 1, borderColor: '#F0F0F0' },
  dataTitle: { fontSize: 16, fontWeight: '900', color: '#333', marginBottom: 15 },
  dataBox: { padding: 15, backgroundColor: '#F8F9FA', borderRadius: 16, textAlign: 'center', fontSize: 16, fontWeight: '700', color: '#555', overflow: 'hidden' },
  
  actionCard: { backgroundColor: '#fff', padding: 20, borderRadius: 24, borderWidth: 1, borderColor: '#F0F0F0' },
  actionTitle: { fontSize: 16, fontWeight: '900', color: '#333', marginBottom: 15 },
  input: { padding: 15, backgroundColor: '#F8F9FA', color: '#111', borderRadius: 16, fontSize: 16, fontWeight: '600', marginBottom: 15 },
  
  bouncyButton: { backgroundColor: '#111', paddingVertical: 18, paddingHorizontal: 24, borderRadius: 100, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.1, shadowRadius: 5, elevation: 3 },
  bouncyButtonText: { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 0.5 }
});
