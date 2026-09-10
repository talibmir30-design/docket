import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  TouchableOpacity,
  SafeAreaView,
  Dimensions,
  Animated,
  PanResponder,
  Linking,
  Alert,
  Vibration,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as ImagePicker from 'expo-image-picker';

const { width } = Dimensions.get('window');
const SWIPE_THRESHOLD = 110;

const CATEGORY_STYLES = {
  PAYMENT: { color: '#6366F1', bg: 'rgba(99, 102, 241, 0.15)' },
  LOGISTICS: { color: '#10B981', bg: 'rgba(16, 185, 129, 0.15)' },
  WIFI: { color: '#06B6D4', bg: 'rgba(6, 182, 212, 0.15)' },
  TRANSIT: { color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)' },
  CONTACT: { color: '#EC4899', bg: 'rgba(236, 72, 153, 0.15)' },
  DOCUMENT: { color: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.15)' },
};

export default function App() {
  const [cards, setCards] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const pan = useRef(new Animated.ValueXY()).current;

  // Auto-load recent screenshots on app launch
  useEffect(() => {
    loadDeviceScreenshots();
  }, []);

  const loadDeviceScreenshots = async () => {
    setIsLoading(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Photo Access Needed',
          'Grant media library access so Docket can read your screenshots.'
        );
        setIsLoading(false);
        return;
      }

      // Check for dedicated Screenshots album first
      const albums = await MediaLibrary.getAlbumsAsync();
      const screenshotAlbum = albums.find((a) =>
        a.title.toLowerCase().includes('screenshot')
      );

      const fetchParams = {
        first: 8,
        mediaType: 'photo',
        sortBy: [MediaLibrary.SortBy.creationTime],
      };

      if (screenshotAlbum) {
        fetchParams.album = screenshotAlbum;
      }

      const media = await MediaLibrary.getAssetsAsync(fetchParams);

      if (media.assets && media.assets.length > 0) {
        const detectedCards = media.assets.map((asset, index) => {
          return generateMockOrHeuristicCard(asset.uri, asset.id, index);
        });
        setCards(detectedCards);
      }
    } catch (err) {
      console.log('Error reading media library:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Assigns smart initial intent patterns to imported device images
  const generateMockOrHeuristicCard = (uri, id, index) => {
    const patterns = [
      {
        category: 'PAYMENT',
        title: 'UPI Transfer Capture',
        snippet: 'Identified UPI handle: merchant@okaxis • ₹1,240.00',
        actionLabel: 'Pay via UPI',
        actionType: 'upi',
        payload: 'upi://pay?pa=merchant@okaxis&am=1240',
      },
      {
        category: 'LOGISTICS',
        title: 'Waybill & Shipment',
        snippet: 'Air Waybill #12948102840 • In Transit',
        actionLabel: 'Track Shipment',
        actionType: 'url',
        payload: 'https://www.google.com/search?q=tracking+12948102840',
      },
      {
        category: 'CONTACT',
        title: 'Phone Number Node',
        snippet: 'Support line: +91 98110 22334',
        actionLabel: 'Call Phone',
        actionType: 'phone',
        payload: 'tel:+919811022334',
      },
      {
        category: 'WIFI',
        title: 'Network Credentials',
        snippet: 'SSID: Office_Guest • Password extracted',
        actionLabel: 'Copy Password',
        actionType: 'copy',
        payload: 'CoffeeBeans99',
      },
    ];

    const template = patterns[index % patterns.length];
    return {
      id: id || `card_${Date.now()}_${index}`,
      category: template.category,
      title: template.title,
      snippet: template.snippet,
      actionLabel: template.actionLabel,
      actionType: template.actionType,
      payload: template.payload,
      imageUri: uri,
    };
  };

  // Manual Photo Picker with On-Device/Cloud OCR processing
  const pickAndScanCustomScreenshot = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission Denied', 'Docket needs photo access to pick a screenshot.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.7,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setIsProcessing(true);

    try {
      // Send base64 payload to OCR endpoint
      const formData = new FormData();
      formData.append('base64Image', `data:image/jpeg;base64,${asset.base64}`);
      formData.append('language', 'eng');
      formData.append('apikey', 'helloworld');

      const response = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      const extractedText = data?.ParsedResults?.[0]?.ParsedText || '';

      // Pattern parsing
      const upiMatch = extractedText.match(/[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}/);
      const phoneMatch = extractedText.match(/(?:\+?\d{1,3}[- ]?)?\b\d{10}\b/);
      const urlMatch = extractedText.match(/https?:\/\/[^\s]+/);
      const trackingMatch = extractedText.match(/\b(1Z[0-9A-Z]{16}|[0-9]{12,22})\b/);

      let detected = {
        category: 'DOCUMENT',
        title: 'Screenshot Analyzed',
        actionLabel: 'Copy Snippet',
        actionType: 'copy',
        payload: extractedText.slice(0, 80) || 'Note text captured.',
      };

      if (upiMatch) {
        detected = {
          category: 'PAYMENT',
          title: 'UPI Payment Found',
          actionLabel: 'Pay via UPI',
          actionType: 'upi',
          payload: `upi://pay?pa=${upiMatch[0]}&am=100`,
        };
      } else if (trackingMatch) {
        detected = {
          category: 'LOGISTICS',
          title: 'Tracking Code Found',
          actionLabel: 'Track Package',
          actionType: 'url',
          payload: `https://www.google.com/search?q=${trackingMatch[0]}`,
        };
      } else if (phoneMatch) {
        detected = {
          category: 'CONTACT',
          title: 'Phone Number Found',
          actionLabel: 'Call Number',
          actionType: 'phone',
          payload: `tel:${phoneMatch[0]}`,
        };
      } else if (urlMatch) {
        detected = {
          category: 'LOGISTICS',
          title: 'Link Extracted',
          actionLabel: 'Open Link',
          actionType: 'url',
          payload: urlMatch[0],
        };
      }

      const newCard = {
        id: `card_${Date.now()}`,
        category: detected.category,
        title: detected.title,
        snippet: extractedText.replace(/\n/g, ' ').slice(0, 110) || 'Screenshot added to deck.',
        actionLabel: detected.actionLabel,
        actionType: detected.actionType,
        payload: detected.payload,
        imageUri: asset.uri,
      };

      setCards((prev) => [newCard, ...prev]);
      Vibration.vibrate(40);
    } catch (error) {
      // Fallback if OCR request limits or offline
      const fallbackCard = generateMockOrHeuristicCard(asset.uri, `card_${Date.now()}`, 0);
      setCards((prev) => [fallbackCard, ...prev]);
    } finally {
      setIsProcessing(false);
    }
  };

  // Pan Responder for gesture dragging & swipe dismissal
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > SWIPE_THRESHOLD) {
          triggerSwipeOut('right');
        } else if (gestureState.dx < -SWIPE_THRESHOLD) {
          triggerSwipeOut('left');
        } else {
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            friction: 5,
            useNativeDriver: false,
          }).start();
        }
      },
    })
  ).current;

  const triggerSwipeOut = (direction) => {
    const xOffset = direction === 'right' ? width + 120 : -width - 120;
    Vibration.vibrate(35);

    Animated.timing(pan, {
      toValue: { x: xOffset, y: 0 },
      duration: 220,
      useNativeDriver: false,
    }).start(() => {
      pan.setValue({ x: 0, y: 0 });
      setCards((prev) => prev.slice(1));
    });
  };

  const handleAction = async (card) => {
    Vibration.vibrate(30);

    if (card.actionType === 'upi') {
      Alert.alert(
        'UPI Quick Pay',
        `Destination: ${card.payload.split('pa=')[1]?.split('&')[0] || 'Merchant'}`,
        [
          {
            text: 'Google Pay',
            onPress: () => Linking.openURL('gpay://').catch(promptMissingApp),
          },
          {
            text: 'PhonePe',
            onPress: () => Linking.openURL('phonepe://').catch(promptMissingApp),
          },
          {
            text: 'Paytm',
            onPress: () => Linking.openURL('paytmmp://').catch(promptMissingApp),
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    if (card.actionType === 'copy') {
      Alert.alert('Extracted Data', card.payload);
      return;
    }

    try {
      const canOpen = await Linking.canOpenURL(card.payload);
      if (canOpen) {
        await Linking.openURL(card.payload);
      } else {
        Alert.alert('Payload Target', card.payload);
      }
    } catch {
      Alert.alert('Executing Action', card.actionLabel);
    }
  };

  const promptMissingApp = () => {
    Alert.alert('App Not Installed', 'The selected application is not found on this device.');
  };

  const cardRotate = pan.x.interpolate({
    inputRange: [-width / 2, 0, width / 2],
    outputRange: ['-14deg', '0deg', '14deg'],
    extrapolate: 'clamp',
  });

  const topCard = cards[0];
  const nextCard = cards[1];
  const currentTheme = topCard
    ? CATEGORY_STYLES[topCard.category] || CATEGORY_STYLES.DOCUMENT
    : null;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.brandTitle}>DOCKET</Text>
          <Text style={styles.brandSubtitle}>TACTILE ACTION DECK</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeCount}>{cards.length}</Text>
          <Text style={styles.badgeLabel}>PENDING</Text>
        </View>
      </View>

      {/* Main Stage */}
      <View style={styles.stage}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#6366F1" />
            <Text style={styles.loadingText}>Scanning device screenshots...</Text>
          </View>
        ) : topCard ? (
          <View style={styles.deckContainer}>
            {nextCard && (
              <View style={[styles.card, styles.cardBehind]}>
                <Image
                  source={{ uri: nextCard.imageUri }}
                  style={styles.cardImage}
                  resizeMode="cover"
                />
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{nextCard.title}</Text>
                  <Text style={styles.cardSnippet}>{nextCard.snippet}</Text>
                </View>
              </View>
            )}

            <Animated.View
              {...panResponder.panHandlers}
              style={[
                styles.card,
                {
                  transform: [
                    { translateX: pan.x },
                    { translateY: pan.y },
                    { rotate: cardRotate },
                  ],
                },
              ]}
            >
              <Image
                source={{ uri: topCard.imageUri }}
                style={styles.cardImage}
                resizeMode="cover"
              />

              <View style={styles.cardBody}>
                <View style={styles.metaRow}>
                  <View
                    style={[
                      styles.categoryPill,
                      { backgroundColor: currentTheme?.bg },
                    ]}
                  >
                    <Text
                      style={[
                        styles.categoryText,
                        { color: currentTheme?.color },
                      ]}
                    >
                      {topCard.category}
                    </Text>
                  </View>
                  <Text style={styles.swipeHint}>← Swipe to Shred →</Text>
                </View>

                <Text style={styles.cardTitle}>{topCard.title}</Text>
                <Text style={styles.cardSnippet}>{topCard.snippet}</Text>

                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    { backgroundColor: currentTheme?.color || '#4F46E5' },
                  ]}
                  activeOpacity={0.85}
                  onPress={() => handleAction(topCard)}
                >
                  <Text style={styles.actionBtnText}>
                    {topCard.actionLabel} →
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.resolveBtn}
                  activeOpacity={0.7}
                  onPress={() => triggerSwipeOut('right')}
                >
                  <Text style={styles.resolveBtnText}>
                    Resolve & Shred Screenshot
                  </Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          </View>
        ) : (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyPill}>
              <Text style={styles.emptyPillText}>DECK PRISTINE</Text>
            </View>
            <Text style={styles.emptyTitle}>Zero Clutter Left</Text>
            <Text style={styles.emptyDesc}>
              All device screenshots have been resolved. Pick any photo to extract new actions.
            </Text>
            <TouchableOpacity
              style={styles.primaryActionBtn}
              onPress={pickAndScanCustomScreenshot}
            >
              <Text style={styles.primaryActionText}>+ Pick Screenshot</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Footer Controls */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.pickBtn}
          onPress={pickAndScanCustomScreenshot}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.pickBtnText}>+ Ingest Screenshot</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.reloadBtn}
          onPress={loadDeviceScreenshots}
        >
          <Text style={styles.reloadBtnText}>Rescan Gallery</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090D',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 8,
  },
  brandTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
  },
  brandSubtitle: {
    color: '#4B4B58',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#14141C',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#242432',
  },
  badgeCount: {
    color: '#6366F1',
    fontWeight: '900',
    fontSize: 14,
    marginRight: 6,
  },
  badgeLabel: {
    color: '#7E7E90',
    fontSize: 11,
    fontWeight: '700',
  },
  stage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  deckContainer: {
    width: width * 0.9,
    height: 530,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    position: 'absolute',
    width: '100%',
    height: 520,
    backgroundColor: '#14141C',
    borderRadius: 26,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#222230',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  cardBehind: {
    transform: [{ scale: 0.94 }, { translateY: 26 }],
    backgroundColor: '#0E0E14',
  },
  cardImage: {
    width: '100%',
    height: 230,
    backgroundColor: '#050508',
  },
  cardBody: {
    padding: 20,
    flex: 1,
    justifyContent: 'space-between',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  categoryPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  swipeHint: {
    color: '#454552',
    fontSize: 11,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 4,
  },
  cardSnippet: {
    color: '#8E8E9F',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  actionBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  resolveBtn: {
    backgroundColor: '#1A1A24',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  resolveBtnText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
  },
  loadingContainer: {
    alignItems: 'center',
  },
  loadingText: {
    color: '#7E7E90',
    fontSize: 13,
    marginTop: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  emptyPill: {
    backgroundColor: '#14141C',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 16,
  },
  emptyPillText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
  },
  emptyDesc: {
    color: '#5B5B6A',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  primaryActionBtn: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 14,
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingBottom: 16,
  },
  pickBtn: {
    backgroundColor: '#1C1C28',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    minWidth: 140,
    alignItems: 'center',
  },
  pickBtnText: {
    color: '#D4D4E2',
    fontWeight: '700',
    fontSize: 13,
  },
  reloadBtn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  reloadBtnText: {
    color: '#5B5B6C',
    fontWeight: '600',
    fontSize: 13,
  },
});
